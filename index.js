#!/usr/bin/env node

// @ts-check
const fs = require('fs')
const path = require('path')
// For solving the problem failed to create a project with number-only argument,
// the second argument of "minimist" is added to convert it to string type.
// const argv = require('minimist')(process.argv.slice(2), { string: ['_'] })
const prompts = require('prompts')
const { green, lightRed, lightGreen } = require('kolorist')
const execa = require('execa')

async function init() {
  let result = {}

  const cmd = await getCmd()

  const npmState = await checkNpmRepository()
  if (!npmState) {
    console.log(
      lightRed('\nPlease create a new npm repository'),
      green(`(use "${cmd[0]} init -y")\n`)
    )
    return
  }

  const gitState = await checkGitRepository()
  if (!gitState) {
    console.log(
      lightRed('\nPlease create a new git repository'),
      green('(use "git init")\n')
    )
    return
  }

  try {
    result = await prompts(
      [
        {
          type: 'toggle',
          name: 'lint',
          message: 'Do you use lint?',
          initial: true,
          active: 'yes',
          inactive: 'no',
        },
        {
          type: 'toggle',
          name: 'gitHooks',
          message: 'Do you use git hooks?',
          initial: true,
          active: 'yes',
          inactive: 'no',
        },
        // {
        //   type: 'toggle',
        //   name: 'test',
        //   message: 'Do you use git hooks?',
        //   initial: true,
        //   active: 'yes',
        //   inactive: 'no',
        // },
      ],
      {
        onCancel: () => {
          throw new Error(lightRed('✖') + ' Operation cancelled')
        },
      }
    )
  } catch (cancelled) {
    console.log(cancelled.message)
    return
  }

  const { lint, gitHooks, test } = result
  console.log(lightGreen('Installing dependencies...'))

  if (lint) {
    await installLintDeps(cmd)
  }
  if (gitHooks) {
    await installGitHooksDeps(cmd)
  }
  if (test) {
    await installTestDeps(cmd)
  }
}

async function installLintDeps(cmd) {
  try {
    const targetPath = process.cwd()

    const pkg = require(path.join(targetPath, 'package.json'))

    if (!pkg.scripts) pkg.scripts = {}

    pkg.scripts.lint = 'eslint --fix .'
    pkg.scripts.test = 'echo "Error: no test specified"'
    pkg['lint-staged'] = {
      '*.js': ['npm run lint', 'prettier --write', 'git add'],
      '*.ts?(x)': [
        'npm run lint',
        'prettier --parser=typescript --write',
        'git add',
      ],
    }
    fs.writeFileSync(
      path.join(targetPath, 'package.json'),
      JSON.stringify(pkg, null, 2)
    )

    await execa(cmd[0], [cmd[1], 'eslint', '-D'])
    await execa(cmd[0], [cmd[1], 'prettier', '-D'])

    const templateDir = path.join(__dirname, 'template-lint')

    const files = fs.readdirSync(templateDir)
    for (const file of files.filter((f) => f !== 'package.json')) {
      copy(path.join(templateDir, file), path.join(targetPath, file))
    }

    console.log(
      green('\n"eslint" and "prettier" packages have been installed\n')
    )
  } catch (error) {
    console.error(error)
    return
  }
}

async function installGitHooksDeps(cmd) {
  try {
    try {
      await execa(cmd[0] === 'pnpm' ? 'pnpx' : 'npx', ['husky-init', '-D'])
    } catch (error) {
      await execa('git', ['init'])
      console.error('I got you', error)
    }

    await execa(cmd[0], ['install'])

    await execa(cmd[0], [cmd[1], '@commitlint/config-conventional', '-D'])
    await execa(cmd[0], [cmd[1], '@commitlint/cli', '-D'])

    fs.writeFileSync(
      path.join(process.cwd(), 'commitlint.config.js'),
      // eslint-disable-next-line quotes
      "module.exports = { extends: ['@commitlint/config-conventional'] }"
    )

    await execa('rm', ['-rf', './.husky/pre-commit'])
    await execa('rm', ['-rf', './.husky/commit-msg'])
    await execa('rm', ['-rf', './.husky/pre-push'])

    await execa('npx', ['husky', 'add', '.husky/pre-commit', 'npx lint-staged'])
    await execa('npx', [
      'husky',
      'add',
      '.husky/commit-msg',
      'npx --no-install commitlint --edit',
    ])
    await execa('npx', ['husky', 'add', '.husky/pre-push', 'npm test'])

    console.log(
      green('\n"husky" and "commitlint" packages have been installed\n')
    )
  } catch (error) {
    console.error(error)
    return
  }
}

async function installTestDeps(cmd) {
  console.log('installTestDeps', cmd)
}

function copy(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    copyDir(src, dest)
  } else {
    fs.copyFileSync(src, dest)
  }
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file)
    const destFile = path.resolve(destDir, file)
    copy(srcFile, destFile)
  }
}

async function getCmd() {
  let cmds = [
    ['yarn', 'add'],
    ['pnpm', 'add'],
    ['npm', 'i'],
  ]
  for (let cmd of cmds) {
    const r = await checkPkgCmd(cmd[0])
    if (r) return cmd
  }
  return ['npm', 'i']
}

/**
 * @param {string | undefined} command package commander tool e.g. yarn
 * @returns string
 */
async function checkPkgCmd(command) {
  try {
    const { stdout } = await execa(command, ['-v'])
    return !!stdout
  } catch (error) {
    return false
  }
}

async function checkGitRepository() {
  try {
    await execa('ls', ['.git'])
    return true
  } catch (error) {
    return false
  }
}

async function checkNpmRepository() {
  try {
    await execa('ls', ['package.json'])
    return true
  } catch (error) {
    return false
  }
}

init().catch((e) => {
  console.error(e)
})
