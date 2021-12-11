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
const commandMap = {
  npm: {
    exec: 'npx',
    templateDownload: 'npx',
    installAll: 'npm install',
    add: 'npm install',
  },
  pnpm: {
    exec: 'pnpm',
    templateDownload: 'pnpm dlx',
    installAll: 'pnpm install',
    add: 'pnpm add',
  },
  yarn: {
    exec: 'yarn',
    templateDownload: 'npx',
    installAll: 'yarn install',
    add: 'yarn add',
  },
}

async function init() {
  try {
    const cmd = await choiceCommand()
    if (!checkNpmRepository()) {
      runCommand(cmd, ['init -y'])
      console.log('\n')
    }

    const promptsResult = await prompts(
      [
        {
          type: 'toggle',
          name: 'codeLint',
          message: 'Do you want use code lint?',
          initial: true,
          active: 'yes',
          inactive: 'no',
        },
        {
          type: 'toggle',
          name: 'gitLint',
          message: 'Do you want use git lint?',
          initial: true,
          active: 'yes',
          inactive: 'no',
        },
      ],
      {
        onCancel: () => {
          throw new Error(`${lightRed('✖')} Operation cancelled`)
        },
      }
    )

    if (promptsResult.codeLint || promptsResult.gitLint) {
      console.log(green('\nInstalling dependencies...\n'))
    }

    if (promptsResult.codeLint) {
      await installCodeLintDeps(cmd)
    }

    if (promptsResult.gitLint) {
      if (!checkGitRepository()) {
        runCommand('git', ['init'])
      }
      await installGitLintDeps(cmd)
    }

    // need setup scripts after install dependencies
    const pkg = require(path.join(root, 'package.json'))

    if (!pkg.scripts) pkg.scripts = {}

    if (promptsResult.gitLint) {
      pkg.scripts.commit = 'git-cz'
      pkg.scripts.test = 'echo "Error: no test specified"'
      pkg['lint-staged'] = {
        '*.js': ['eslint --fix', 'prettier --write', 'git add'],
        '*.ts?(x)': [
          'eslint --fix',
          'prettier --parser=typescript --write',
          'git add',
        ],
      }
    }
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(pkg, null, 2)
    )
  } catch (error) {
    console.log(error.message)
    return
  }
}

async function installCodeLintDeps(cmd) {
  try {
    await runCommand(commandMap[cmd].add, [
      'eslint',
      'prettier',
      'eslint-plugin-prettier',
      'eslint-config-prettier',
      '-D',
    ])

    // copy templated files
    const templateDir = path.join(__dirname, 'template-code-lint')
    const files = fs.readdirSync(templateDir)
    for (const file of files.filter((f) => f !== 'package.json')) {
      copy(
        path.join(templateDir, file),
        path.join(root, file.replace(/^_/, '.'))
      )
    }

    // reset eslintrc config file
    // Pass through the corresponding stdio stream to/from the parent process.
    await runCommand(commandMap[cmd].exec, ['eslint', '--init'], {
      stdio: 'inherit',
    })
    let eslintrcPath = path.join(root, '.eslintrc.js')
    let extname = 'js'
    if (!fs.existsSync(eslintrcPath)) {
      eslintrcPath = path.join(root, '.eslintrc.json')
      extname = 'json'
    }
    if (!fs.existsSync(eslintrcPath)) {
      console.log(
        lightRed(
          '\nYou must use JavaScript or JSON format to store configuration files\n'
        )
      )
      return
    }
    const eslintrc = require(eslintrcPath)
    eslintrc.extends.push('plugin:prettier/recommended')
    eslintrc.rules = {
      'import/prefer-default-export': 'off',
      'no-restricted-syntax': 'off',
      'no-use-before-define': ['error', { functions: false, classes: false }],
      'import/no-unresolved': 'off',
      'import/extensions': 'off',
      'import/no-absolute-path': 'off',
      'import/no-extraneous-dependencies': 'off',
      'no-param-reassign': [
        'error',
        {
          props: true,
          ignorePropertyModificationsFor: ['state', 'config'],
        },
      ],
      ...eslintrc.rules,
    }
    let eslintrcStr = JSON.stringify(eslintrc, null, 2)
    if (extname === 'js') {
      eslintrcStr = `module.exports = ${eslintrcStr}`
    }
    fs.writeFileSync(eslintrcPath, eslintrcStr)
    // format eslintrc file
    await runCommand(commandMap[cmd].exec, ['prettier', '--write', '.'])
    await runCommand('rm', ['-rf', 'node_modules'])
    await runCommand(commandMap[cmd].installAll)
  } catch (error) {
    throw new Error(error)
  }
}

async function installGitLintDeps(cmd) {
  try {
    await runCommand(commandMap[cmd].templateDownload, ['husky-init -D'])
    await runCommand('rm', ['-rf', 'node_modules'])
    await runCommand(commandMap[cmd].installAll)

    await runCommand(commandMap[cmd].add, [
      '@commitlint/config-conventional',
      '@commitlint/cli',
      'commitizen',
      '-D',
    ])

    fs.writeFileSync(
      path.join(root, 'commitlint.config.js'),
      "module.exports = { extends: ['@commitlint/config-conventional'] }"
    )
    // copy templated files
    const templateDir = path.join(__dirname, 'template-git-lint')
    const files = fs.readdirSync(templateDir)
    for (const file of files.filter((f) => f !== 'package.json')) {
      copy(
        path.join(templateDir, file),
        path.join(root, file.replace(/^_/, '.'))
      )
    }

    await runCommand('rm', ['-rf', './.husky/pre-commit'])
    await runCommand('rm', ['-rf', './.husky/commit-msg'])
    await runCommand('rm', ['-rf', './.husky/pre-push'])

    await runCommand(commandMap[cmd].exec, [
      'commitizen init cz-conventional-changelog --save-dev --save-exact',
    ])
    await execa('npx', ['husky', 'add', '.husky/pre-commit', 'npx lint-staged'])
    await execa('npx', [
      'husky',
      'add',
      '.husky/commit-msg',
      'npx --no-install commitlint --edit',
    ])
    await execa('npx', ['husky', 'add', '.husky/pre-push', `${cmd} run test`])
    await execa('chmod', ['-R', '-X', './.husky'])
  } catch (error) {
    console.error(error)
    return
  }
}

async function runCommand(cmd, args = [], options = {}) {
  console.log(green(`\nrunning command: \`${cmd} ${args.join(' ')}\``))
  const childProcess = await execa.command(`${cmd} ${args.join(' ')}`, options)
  console.log(lightGreen(`${childProcess.stdout}\n`))
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

async function choiceCommand() {
  try {
    let choices = [
      {
        title: 'pnpm',
        description: 'recommended to use pnpm to manage your package',
        value: 'pnpm',
      },
      {
        title: 'yarn',
        value: 'yarn',
      },
      {
        title: 'npm',
        value: 'npm',
      },
    ]
    choices = choices.filter((choice) => {
      try {
        const result = execa.sync('which', [choice.value])
        return !result.failed
      } catch (error) {
        return !error.failed
      }
    })
    const result = await prompts(
      {
        type: 'select',
        name: 'value',
        message: 'Pick a package manager tool',
        choices,
        initial: 0,
      },
      {
        onCancel: () => {
          throw new Error(`${lightRed('✖')} Operation cancelled`)
        },
      }
    )
    return result.value
  } catch (error) {
    throw new Error(error.message)
  }
}

function checkGitRepository() {
  try {
    return fs.existsSync(path.join(root, '.git'))
  } catch (error) {
    return false
  }
}

function checkNpmRepository() {
  try {
    return fs.existsSync(path.join(root, 'package.json'))
  } catch (error) {
    return false
  }
}

init().catch((e) => {
  console.error(e)
})
