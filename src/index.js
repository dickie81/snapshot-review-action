/* eslint-disable no-console */
const core = require('@actions/core');
const github = require('@actions/github');

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const glob = require('glob');
const {
  diffImageToSnapshot,
} = require('jest-image-snapshot/src/diff-snapshot');
const { rimraf } = require('rimraf');

const tokenFromInput = core.getInput('token');
const snapshotsDirectoryFromInput = core.getInput('snapshots-dir');
const diffDir = './snapshot-diff';
const baseBranchNameFromInput = core.getInput('base-branch-name');
const branchNameFromInput = core.getInput('branch-name');
const prNumberFromInput = core.getInput('pr-number');
const reviewRepoRemotePathFromInputFromInput = core.getInput('review-repo-remote-path') || '[STORYBOOK_REMOTE]';

const octokit = github.getOctokit(tokenFromInput)

const execCommand = (command) =>
  new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stderr) {
        reject(stderr);
        return;
      }

      resolve(
        stdout
          .split('\n')
          .map((filePath) => filePath.trim())
          .filter((filePath) => !!filePath),
      );
    });
  });

const deleteDir = (dir) => rimraf(dir);

const globAsync = (pattern) =>
  new Promise((resolve, reject) => {
    glob(pattern, (er, files) => {
      if (er) {
        reject(er);
      }

      resolve(files);
    });
  });

const fileExists = async (filePath) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const isDirectoryEmpty = async (dirName) =>
  !(await fs.promises.readdir(dirName)).length;

const removeEmptyDirs = async (globPattern) => {
  const dirs = await globAsync(globPattern);
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (await isDirectoryEmpty(dir)) {
      fs.promises.rmdir(dir);
    }
  }
};

const run = async () => {
  try {

    const { data: pullRequest } = await octokit.rest.pulls.get({
        owner: 'dickie81',
        repo: 'snapshot-review-action',
        pull_number: prNumberFromInput,
        mediaType: {
          format: 'diff'
        }
    });

    console.log(pullRequest);

    const filePaths = await execCommand(
      `git --no-pager diff origin/${baseBranchNameFromInput}...origin/${branchNameFromInput} --name-only | grep ^${snapshotsDirectoryFromInput}`,
    );

    const originUrl = await execCommand('git config --get remote.origin.url');
    const origin = originUrl[0].split('.git')[0];
    const prLink = prNumberFromInput ? `pull/${prNumberFromInput}` : `tree/${branchNameFromInput}`;

    await deleteDir(diffDir);

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const destPath = `${diffDir}/${filePath.split(snapshotsDirectoryFromInput)[1]}`;
      const destPathParsed = path.parse(destPath);
      const destDir = destPathParsed.dir;
      const destName = destPathParsed.name;
      const snapshotIdentifier = destName.split('-snap')[0];

      await fs.promises.mkdir(path.join(destDir, 'diff'), { recursive: true });
      try {
        await execCommand(`git show origin/${baseBranchNameFromInput}:./${filePath} > ${destPath}`);

        const diffOpts = {
          receivedImageBuffer: fs.readFileSync(filePath),
          snapshotIdentifier,
          snapshotsDir: path.join(__dirname, '..', destDir),
          diffDir: path.join(__dirname, '..', destDir, 'diff'),
          failureThresholdType: 'pixel',
          failureThreshold: 0,
          receivedDir: diffDir,
        };

        diffImageToSnapshot(diffOpts);
      } catch {
        // nothing on dev - new snapshot, just copy
        const origFilePath = path.join(__dirname, '..', filePath);
        const newFilePath = path.join(
          __dirname,
          '..',
          destDir,
          'diff',
          `${snapshotIdentifier}-new.png`,
        );

        if (await fileExists(origFilePath)) {
          await fs.promises.copyFile(origFilePath, newFilePath);
        }
      }
    }

    // remove original dev files
    const originals = await globAsync(`${diffDir}/*/*.png`);
    originals.forEach((file) => {
      fs.unlinkSync(file);
    });

    // move diffs to parent dir
    const diffs = await globAsync(`${diffDir}/*/diff/*.png`);
    diffs.forEach((file) => {
      fs.renameSync(file, file.split('/diff/').join('/'));
    });

    // remove diff dir
    await removeEmptyDirs(`${diffDir}/*/diff`);
    await removeEmptyDirs(`${diffDir}/*`);

    const readMe = [
      `# Image snapshot diff files for [${branchName}](${origin}/${prLink})`,
      '',
    ];
    const newSnaps = [];
    const updatedSnaps = [];

    const dirs = await globAsync(`${diffDir}/*`);

    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i];
      const storyId = dir.split('/').pop();
      const isNew = !!(await globAsync(`${dir}/*-new.png`)).length;
      (isNew ? newSnaps : updatedSnaps).push(`- [${storyId}](./${storyId})`);

      fs.writeFileSync(
        `${dir}/README.md`,
        [
          `# ${storyId}`,
          ...(branchNameFromInput
            ? [
                '',
                `[View in storybook](https://raw.githack.com/${reviewRepoRemotePathFromInputFromInput}/PR-${prNumberFromInput}-sb/index.html?path=/story/${storyId})`,
              ]
            : []),
        ].join('\n'),
      );
    }

    if (newSnaps.length) {
      readMe.push('## New snapshots', ...newSnaps, '');
    }

    if (updatedSnaps.length) {
      readMe.push('## Updated snapshots', ...updatedSnaps, '');
    }

    fs.writeFileSync(`${diffDir}/README.md`, readMe.join('\n'));
    core.setOutput(filePaths);
  } catch (e) {
    // exit code 1 for grep means "no match"
    console.log("err", e)

    if (e.code === 1) {
      console.log('no diff');
      core.setOutput([]);
    } else {
      core.setFailed(error.message);
    }
  } 
}

run();

