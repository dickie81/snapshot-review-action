/* eslint-disable no-console */
import { getInput, setOutput, setFailed } from '@actions/core';
import { getOctokit } from '@actions/github';

import  { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import glob from 'glob';
import {
  diffImageToSnapshot,
} from 'jest-image-snapshot/src/diff-snapshot';
import { rimraf } from 'rimraf';

const diffDir = './snapshot-diff';
const tokenFromInput = getInput('token');
const snapshotsDirectoryFromInput = getInput('snapshots-dir');
const baseBranchNameFromInput = getInput('base-branch-name');
const branchNameFromInput = getInput('branch-name');
const prNumberFromInput = getInput('pr-number');
const reviewRepoRemotePathFromInputFromInput = getInput('review-repo-remote-path') || '[STORYBOOK_REMOTE]';

const octokit = getOctokit(tokenFromInput)

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

    const filePaths = await execCommand(
      `GH_TOKEN=${tokenFromInput} gh pr diff ${prNumberFromInput} --name-only`,
    );

    console.log("Found the following modified files:", filePaths);

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
      const diffDir = path.join(destDir, 'diff');

      console.log("Creating diff directory:", diffDir);

      await fs.promises.mkdir(diffDir, { recursive: true });
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
    setOutput(filePaths);
  } catch (e) {
    // exit code 1 for grep means "no match"
    console.log("err", e)

    if (e.code === 1) {
      console.log('no diff');
      setOutput([]);
    } else {
      setFailed(e.message);
    }
  } 
}

run();

