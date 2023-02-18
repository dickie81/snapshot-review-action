/* eslint-disable no-console */
import  { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from "node:os";
import { promisify } from 'node:util';

import { getInput, setOutput, setFailed } from '@actions/core';
import { getOctokit } from '@actions/github';

import glob from 'glob';
import { diffImageToSnapshot } from 'jest-image-snapshot/src/diff-snapshot';
import { rimraf } from 'rimraf'; 

const execPromise = promisify(exec);
const fsOpen = promisify(fs.open);
const fsWrite = promisify(fs.write);

const tempDir = os.tmpdir();
const diffDir = path.join(tempDir, 'snapshot-diff');
const tokenFromInput = getInput('token');
const snapshotsDirectoryFromInput = getInput('snapshots-dir');
const baseBranchNameFromInput = getInput('base-branch-name');
const branchNameFromInput = getInput('branch-name');
const prNumberFromInput = getInput('pr-number');
const reviewRepoRemotePathFromInputFromInput = getInput('review-repo-remote-path') || '[STORYBOOK_REMOTE]';

const octokit = getOctokit(tokenFromInput)

console.log("Temp directory found:", tempDir);

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
      const destPath = path.join(diffDir, filePath.split(snapshotsDirectoryFromInput)[1]);
      const destPathParsed = path.parse(destPath);
      const destDir = destPathParsed.dir;
      const destName = destPathParsed.name;
      const snapshotIdentifier = destName.split('-snap')[0];
      const diffDirPath = path.join(destDir, 'diff');

      console.log("Creating diff directory:", diffDirPath);

      await fs.promises.mkdir(diffDirPath, { recursive: true });

      const { stdout } = await execPromise(`ls ${tempDir}`);

      console.log("ls tempDir", stdout);

      try {
        console.log(`git show origin/${baseBranchNameFromInput}:./${filePath} > ${destPath}`);

        const { data } = await octokit.rest.repos.getContent({ "owner": 'dickie81', "repo": 'snapshot-review-action', "path": filePath, "ref": baseBranchNameFromInput })

        const buf = Buffer.from(data.content, data.encoding);

        const fileHandle = await fsOpen(destPath, "a");

        fsWrite(fileHandle, buf);

        console.log(data);

        //await execCommand(`git show origin/${baseBranchNameFromInput}:./${filePath} > ${destPath}`);

        const { stdout } = await execPromise(`ls ${diffDir}`);

        console.log(`ls ${diffDir} --->`, stdout);

        const diffOpts = {
          receivedImageBuffer: fs.readFileSync(filePath),
          snapshotIdentifier,
          snapshotsDir: path.join(__dirname, '..', destDir),
          diffDir: path.join(__dirname, '..', destDir, 'diff'),
          failureThresholdType: 'pixel',
          failureThreshold: 0,
          receivedDir: diffDir,
        };

        console.log(diffOpts);

        diffImageToSnapshot(diffOpts);
      } catch (x) {
        console.log(x);

        // nothing on dev - new snapshot, just copy
        const origFilePath = path.join(__dirname, '..', filePath);

        console.log("origFilePath", origFilePath);

        const newFilePath = path.join(
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
      `# Image snapshot diff files for [${branchNameFromInput}](${origin}/${prLink})`,
      '',
    ];
    const newSnaps = [];
    const updatedSnaps = [];

    const dirs = await globAsync(`${diffDir}/*`);

    console.log("dirs", dirs);

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

