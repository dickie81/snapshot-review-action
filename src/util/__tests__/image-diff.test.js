import fs from 'node:fs';
import path from 'node:path';
import * as url from 'node:url';

import imageDiff from '../image-diff';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const origImageBuff = fs.readFileSync(
  path.resolve(__dirname, '__fixtures__/mona.png'),
);

describe('image-diff util', () => {
  it('will report number of pixels that differ between 2 image buffers of the same size and produce a diff image highlighting differing pixels', () => {
    const compImageBuff = fs.readFileSync(
      path.resolve(__dirname, '__fixtures__/mona-with-glasses.png'),
    );
    const diffImageBuff = fs.readFileSync(
      path.resolve(__dirname, '__fixtures__/diff-glasses.png'),
    );

    const imageDiffResult = imageDiff(origImageBuff, compImageBuff);

    expect(imageDiffResult.pixelCount).toBe(2171);

    const imageDiffDiffResult = imageDiff(
      diffImageBuff,
      imageDiffResult.buffer,
    );

    expect(imageDiffDiffResult.pixelCount).toBe(0);
  });

  it('will report number of pixels that differ between 2 image buffers of differing sizes and produce a diff image highlighting differing pixels', () => {
    const compImageBuff = fs.readFileSync(
      path.resolve(__dirname, '__fixtures__/mona-half.png'),
    );
    const diffImageBuff = fs.readFileSync(
      path.resolve(__dirname, '__fixtures__/diff-half.png'),
    );

    const imageDiffResult = imageDiff(origImageBuff, compImageBuff);

    expect(imageDiffResult.pixelCount).toBe(106710);

    const imageDiffDiffResult = imageDiff(
      diffImageBuff,
      imageDiffResult.buffer,
    );

    expect(imageDiffDiffResult.pixelCount).toBe(0);
  });

  it('will report 0 pixels if the image buffers match', () => {
    const imageDiffResult = imageDiff(origImageBuff, origImageBuff);

    expect(imageDiffResult.pixelCount).toBe(0);
  });
});
