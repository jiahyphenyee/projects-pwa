# Working together on this repo

Two people change this code: Jia Yee (owner) and William. These rules keep the live Google Sheet and Xero safe and keep
Jia Yee aware of every change.

## Jia Yee's rules (owner)
1. **Ask first.** If anything about a change is unclear, ask Jia Yee before editing any code.
2. **Every change is a pull request.** Never push to `main`, never merge into `main` yourself. Jia Yee reviews and merges.
3. **Keep a list of changes.** Every PR adds its entry to `CHANGELOG.md` under *Unreleased*, and to
   `CHANGES-WILLIAM.md` (one line per PR: date, PR number, what, status).

## The flow
1. **Agree the change first.** Write it in one or two lines and send it to Jia Yee. Start once she's clear on it.
2. **Branch from `main`.** Name it `william/<short-topic>`.
3. **Keep it small.** One change per PR, ideally under ~300 lines, so it can be reviewed the same day.
4. **Open a PR** using the template: what changed, why, how it was tested, and whether it touches live data.
   Jia Yee is requested as reviewer automatically (CODEOWNERS) and GitHub emails her.
5. **Check the Vercel preview link** on the PR and say so in the PR.
6. **Jia Yee merges** ("Squash and merge"). Vercel then deploys `main` to production.

## Extra care: changes that touch live data
Anything that **writes** to the Google Sheet or Xero, changes Sheet columns or tab names, login/PIN, env vars,
money maths or dependencies must say so in the PR title (`[data]` or `[schema]`) and be tested against a copy
of the Sheet / the Xero demo company, never the live ones.

## Shared data contract
Both apps read and write the same workbook. Any change to a tab name, a column, or what a column means:
- goes in `architecture-decisions.md`,
- is called out in the PR title with `[schema]`,
- is always in the reviewed-first lane.

## Staying in sync
- Pull `main` before starting each day: `git pull --rebase origin main`.
- Say in the PR (or our chat) what you're picking up, so we don't build the same thing twice.
- Every Friday, 15 minutes: what shipped, what's next, who takes what.
