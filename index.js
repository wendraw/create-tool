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

const root = process.cwd()
const promptsResult = {}

async function init() {
  const npmState = await checkNpmRepository()
  if (!npmState) {
    console.log('\nPlease create a new npm repository. use:\n')
    console.log(green('  npm init -y\n'))
    return
  }

  const gitState = await checkGitRepository()
  if (!gitState) {
    console.log('\nPlease create a new npm repository. use:\n')
    console.log(green('  git init\n'))
    return
  }

  try {
    const result = await prompts(
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
      ],
      {
        onCancel: () => {
          throw new Error(lightRed('✖') + ' Operation cancelled')
        },
      }
    )
    Object.assign(promptsResult, result)
  } catch (cancelled) {
    console.log(cancelled.message)
    return
  }

  if (promptsResult.lint || promptsResult.gitHooks) {
    console.log(lightGreen('\nInstalling dependencies...\n'))
  }

  const cmd = await getCmd()

  if (promptsResult.lint) {
    await installLintDeps(cmd)
  }
  if (promptsResult.gitHooks) {
    await installGitHooksDeps(cmd)
  }

  const pkg = require(path.join(root, 'package.json'))
  if (!pkg.scripts) pkg.scripts = {}
  if (promptsResult.lint) {
    pkg.scripts.lint = 'eslint --fix .'
    await installLintDeps(cmd)
  }
  if (promptsResult.gitHooks) {
    pkg.scripts.test = 'echo "Error: no test specified"'
    pkg['lint-staged'] = {
      '*.js': ['npm run lint', 'prettier --write', 'git add'],
      '*.ts?(x)': [
        'npm run lint',
        'prettier --parser=typescript --write',
        'git add',
      ],
    }
  }
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(pkg, null, 2)
  )

  if (promptsResult.lint) {
    console.log('\nNow run:\n')
    console.log(green('  npx eslint --init\n'))
    console.log('to configure a ESLint\n')
  }
}

async function installLintDeps(cmd) {
  try {
    await install(cmd[0], [cmd[1], 'eslint', '-D'])
    await install(cmd[0], [cmd[1], 'prettier', '-D'])

    const templateDir = path.join(__dirname, 'template-lint')

    const files = fs.readdirSync(templateDir)
    for (const file of files.filter((f) => f !== 'package.json')) {
      copy(path.join(templateDir, file), path.join(root, file))
    }
  } catch (error) {
    console.error(error)
    return
  }
}

async function installGitHooksDeps(cmd) {
  try {
    await install(cmd[0] === 'pnpm' ? 'pnpx' : 'npx', ['husky-init', '-D'])
    await install(cmd[0], ['install'])

    await install(cmd[0], [cmd[1], '@commitlint/config-conventional', '-D'])
    await install(cmd[0], [cmd[1], '@commitlint/cli', '-D'])

    fs.writeFileSync(
      path.join(root, 'commitlint.config.js'),
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
    await execa('npx', ['husky', 'add', '.husky/pre-push', 'npm run test'])
  } catch (error) {
    console.error(error)
    return
  }
}

async function install(cmd, args) {
  const result = await execa(cmd, args)
  console.log(lightGreen(`${result.stdout}\n`))
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
