#!/usr/bin/env node

const program = require("commander");
const prettyBytes = require("pretty-bytes");
const chalk = require("chalk");
const _ = require("lodash");
const moment = require("moment");
var inquirer = require("inquirer");
const Octokit = require("@octokit/rest");

const dotenv = require("dotenv");

dotenv.config();

program.option(
  "-t, --token <PAT>",
  "Your GitHub PAT (leave blank for prompt or set $GH_PAT)"
);
program.option(
  "-u, --user <username>",
  "Your GitHub username (leave blank for prompt or set $GH_USER)"
);
program.option(
  "-o, --org <organization>",
  "Organization name (leave blank for prompt or set $GH_ORG)"
);

program.option("-t, --team <team>", "Team slug");

program.parse(process.argv);

let teamExists = false;
let teamId = 0;
let teamUrl = null;
let teamSlug = null;

var octokit;

const findTeam = async ({ owner, org, team }) => {
  var ui = new inquirer.ui.BottomBar();

  // UI
  // var i = 4;
  // var loader = ["/ Loading", "| Loading", "\\ Loading", "- Loading"];
  // var ui = new inquirer.ui.BottomBar({ bottomBar: loader[0] });

  // const loadingInterval = setInterval(() => {
  //   ui.updateBottomBar(loader[i++ % 4]);
  // }, 200);

  ui.log.write(
    `${chalk.dim("[1/3]")} Verifying team ${chalk.green(team)} exists...`
  );

  try {
    // clearInterval(loadingInterval);
    var { data } = await octokit.teams.getByName({ org, team_slug: team });
  } catch (e) {
    // clearInterval(loadingInterval);
    if (e.status === 404) {
      teamExists = false;
    }
  }

  if (
    _.get(data, "organization", false) &&
    _.get(data, "organization.login", false) === org
  ) {
    teamExists = true;
    teamId = data.id;
    teamUrl = data.html_url;
    teamSlug = data.slug;
  }

  if (teamExists) {
    ui.log.write(`${chalk.dim("[2/3]")} Team ${chalk.green(team)} found.`);
  }
};

async function createTeam({ owner, org, team }) {
  if (teamExists) return;

  var ui = new inquirer.ui.BottomBar();

  ui.log.write(`${chalk.dim("[2/3]")} Team ${chalk.green(team)} not found. `);

  await inquirer
    .prompt([
      {
        type: "confirm",
        name: "createTeam",
        message: `Create it now?`
      },
      {
        type: "input",
        name: "newTeamName",
        default: function() {
          return program.team;
        },
        message: "Team name",
        when: function({ createTeam }) {
          return createTeam;
        }
      },
      {
        type: "input",
        name: "teamDescription",
        message: "Team description",
        when: function({ createTeam }) {
          return createTeam;
        }
      }
    ])
    .then(async function({ createTeam, newTeamName, teamDescription }) {
      if (!createTeam) {
        process.exit();
      } else {
        var {
          data: { id, html_url, slug }
        } = await octokit.teams.create({
          org,
          name: newTeamName,
          privacy: "secret",
          description: teamDescription
        });

        teamExists = true;
        teamId = id;
        teamUrl = html_url;
        teamSlug = slug;
      }
    });
}

async function inviteMembers({ org, team }) {
  var ui = new inquirer.ui.BottomBar();

  await inquirer
    .prompt([
      {
        type: "editor",
        name: "csv",
        message: "Provide a comma separated list of usernames or email"
      }
    ])
    .then(async ({ csv }) => {
      const invitees = csv.split(",").map(i => i.trim());

      ui.log.write(
        `${chalk.dim("[3/3]")} Sending invitation to ${chalk.yellow(
          invitees.length
        )} users:`
      );

      ui.log.write(chalk.yellow("- " + invitees.join("\n- ")));

      const invites = await invitees.reduce(async (promisedRuns, i) => {
        const memo = await promisedRuns;

        if (i.indexOf("@") > -1) {
          // assume valid email
          const res = await octokit.orgs.createInvitation({
            org,
            team_ids: [teamId],
            email: i
          });
        } else {
          // assume valid username
          const res = await octokit.teams.addOrUpdateMembershipInOrg({
            org,
            team_slug: teamSlug,
            username: i
          });
        }

        // TODO what to return?
        return memo;
      }, []);

      ui.log.write(`${chalk.dim("[OK]")} Done. Review invitations at:`);
      ui.log.write(teamUrl);
    });
}

inquirer
  .prompt([
    {
      type: "password",
      name: "PAT",
      message: "What's your GitHub PAT?",
      default: function() {
        return program.token || process.env.GH_PAT;
      }
    },
    {
      type: "input",
      name: "owner",
      message: "Your username?",
      default: function() {
        return program.user || process.env.GH_USER;
      }
    },
    {
      type: "input",
      name: "org",
      message: "Which organization?",
      default: function() {
        return program.org || process.env.GH_ORG;
      }
    },
    {
      type: "input",
      name: "team",
      message: "Which team?",
      suffix:
        " (provide the slug of an existing team, or the full name of the team being created)",
      validate: function(value) {
        return value.length > 3
          ? true
          : "Please provide at least 4 characters.";
      },
      default: function() {
        return program.team;
      }
    }
  ])
  .then(async function(answers) {
    octokit = new Octokit({
      auth: answers.PAT
    });

    await findTeam({ ...answers });
    await createTeam({ ...answers });
    await inviteMembers({ ...answers });

    process.exit();
  });
