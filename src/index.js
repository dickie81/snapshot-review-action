/* eslint-disable no-console */
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

import { getInput, setOutput, setFailed, info } from '@actions/core';
import { getOctokit, context } from '@actions/github';

import imageDiff from './util/image-diff.js';
import globAsync from './util/glob-async.js';
import deleteDir from './util/delete-dir.js';

const execPromise = promisify(exec);

const tempDir = os.tmpdir();

export const run = async ({
  diffDir,
  tokenFromInput,
  snapshotsDirectoryFromInput,
  baseBranchNameFromInput,
  branchNameFromInput,
  prNumberFromInput,
}) => {
  const octokit = getOctokit(tokenFromInput);

  const { data } = await octokit.rest.pulls.listFiles({
    pull_number: prNumberFromInput,
    ...context.repo,
  });

  const filePaths = data.map(({ filename }) => filename);

  info(`Found the following modified files: ${JSON.stringify(filePaths)}`);

  await deleteDir(diffDir);

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const destPath = path.join(
      diffDir,
      filePath.split(snapshotsDirectoryFromInput)[1],
    );
    const destPathParsed = path.parse(destPath);
    const destDir = destPathParsed.dir;
    const destName = destPathParsed.name;

    info(`Creating dest directory: ${destDir}`);

    const { data: origData } = await octokit.rest.repos.getContent({
      ...context.repo,
      path: filePath,
      ref: baseBranchNameFromInput,
    });

    const { data: prData } = await octokit.rest.repos.getContent({
      ...context.repo,
      path: filePath,
      ref: branchNameFromInput,
    });

    const origImageBuff = Buffer.from(origData.content, origData.encoding);
    const prImageBuff = Buffer.from(prData.content, prData.encoding);

    const imageDiffResult = imageDiff(origImageBuff, prImageBuff);

    if (imageDiffResult.pixelCount > 0) {
      // diff detected
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(destDir, `${destName}.png`),
        imageDiffResult.buffer,
      );
    }
  }

  const filesWritten = await globAsync(`${diffDir}/**`);

  console.log("files:", filesWritten);

  const readMe = [
    `# Image snapshot diff files for [${branchNameFromInput}](https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${prNumberFromInput})`,
    '',
  ];
  const newSnaps = [];
  const updatedSnaps = [];

  const dirs = await globAsync(`${diffDir}/**/`);

  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];

    console.log(i, dir);

    const storyId = dir.split('/').pop();
    const isNew = !!(await globAsync(`${dir}/*-new.png`)).length;
    (isNew ? newSnaps : updatedSnaps).push(`- [${storyId}](./${storyId})`);

    await fs.promises.writeFile(
      `${dir}/README.md`,
      [`# ${storyId}`].join('\n'),
    );
  }

  if (newSnaps.length) {
    readMe.push('## New snapshots', ...newSnaps, '');
  }

  if (updatedSnaps.length) {
    readMe.push('## Updated snapshots', ...updatedSnaps, '');
  }

  console.log(readMe.join('\n'));

  await fs.promises.writeFile(`${diffDir}/README.md`, readMe.join('\n'));


  setOutput("changes", filesWritten);
};

run({
  tempDir,
  diffDir: path.join(tempDir, 'snapshot-diff'),
  tokenFromInput: getInput('token'),
  snapshotsDirectoryFromInput: getInput('snapshots-dir'),
  baseBranchNameFromInput: getInput('base-branch-name'),
  branchNameFromInput: getInput('branch-name'),
  prNumberFromInput: getInput('pr-number'),
});
