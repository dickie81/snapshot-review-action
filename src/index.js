/* eslint-disable no-console */
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

import { getInput, setOutput, setFailed } from '@actions/core';
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
  reviewRepoRemotePathFromInputFromInput,
}) => {
  const octokit = getOctokit(tokenFromInput);

  const { data } = await octokit.rest.pulls.listFiles({
    pull_number: prNumberFromInput,
    ...context.repo,
  });

  const filePaths = data.map(({ filename }) => filename);

  console.log('Found the following modified files:', filePaths);

  const origin = context.payload.repository.html_url;
  const prLink = `pull/${prNumberFromInput}`;

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

    console.log('Creating dest directory:', destDir);

    const { data: origData } = await octokit.rest.repos.getContent({
      owner: 'dickie81',
      repo: 'snapshot-review-action',
      path: filePath,
      ref: baseBranchNameFromInput,
    });

    const { data: prData } = await octokit.rest.repos.getContent({
      owner: 'dickie81',
      repo: 'snapshot-review-action',
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
        path.join(destDir, destName),
        imageDiffResult.buffer,
      );
    }
  }

  const readMe = [
    `# Image snapshot diff files for [${branchNameFromInput}](${origin}/${prLink})`,
    '',
  ];
  const newSnaps = [];
  const updatedSnaps = [];

  const dirs = await globAsync(`${diffDir}/**/`);

  console.log('dirs', dirs);

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

  const filesWritten = await globAsync(`${diffDir}/**`);

  console.log('filesWritten', filesWritten);

  setOutput(filePaths);
};

run({
  tempDir,
  diffDir: path.join(tempDir, 'snapshot-diff'),
  tokenFromInput: getInput('token'),
  snapshotsDirectoryFromInput: getInput('snapshots-dir'),
  baseBranchNameFromInput: getInput('base-branch-name'),
  branchNameFromInput: getInput('branch-name'),
  prNumberFromInput: getInput('pr-number'),
  reviewRepoRemotePathFromInputFromInput:
    getInput('review-repo-remote-path') || '[STORYBOOK_REMOTE]',
});
