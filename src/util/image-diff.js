import pixelmatch from 'pixelmatch';

import { PNG } from 'pngjs';

const createImageResizer = (width, height) => (source) => {
  const resized = new PNG({ width, height, fill: true });
  PNG.bitblt(source, resized, 0, 0, source.width, source.height, 0, 0);
  return resized;
};

const fillSizeDifference = (width, height) => (image) => {
  const inArea = (x, y) => y > height || x > width;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (inArea(x, y)) {
        const idx = (image.width * y + x) << 2;
        image.data[idx] = 0;
        image.data[idx + 1] = 0;
        image.data[idx + 2] = 0;
        image.data[idx + 3] = 64;
      }
    }
  }
  return image;
};

const alignImagesToSameSize = (firstImage, secondImage) => {
  const firstImageWidth = firstImage.width;
  const firstImageHeight = firstImage.height;
  const secondImageWidth = secondImage.width;
  const secondImageHeight = secondImage.height;
  // Calculate biggest common values
  const resizeToSameSize = createImageResizer(
    Math.max(firstImageWidth, secondImageWidth),
    Math.max(firstImageHeight, secondImageHeight),
  );
  // Resize both images
  const resizedFirst = resizeToSameSize(firstImage);
  const resizedSecond = resizeToSameSize(secondImage);
  // Fill resized area with black transparent pixels
  return [
    fillSizeDifference(firstImageWidth, firstImageHeight)(resizedFirst),
    fillSizeDifference(secondImageWidth, secondImageHeight)(resizedSecond),
  ];
};

export default (origImageBuff, comparisonImageBuff) => {
  const rawOrigImage = PNG.sync.read(origImageBuff);
  const rawCompImage = PNG.sync.read(comparisonImageBuff);

  const hasSizeMismatch =
    rawCompImage.height !== rawOrigImage.height ||
    rawCompImage.width !== rawOrigImage.width;

  const imageDimensions = {
    receivedHeight: rawCompImage.height,
    receivedWidth: rawCompImage.width,
    baselineHeight: rawOrigImage.height,
    baselineWidth: rawOrigImage.width,
  };

  // Align images in size if different
  const [compImage, origImage] = hasSizeMismatch
    ? alignImagesToSameSize(rawCompImage, rawOrigImage)
    : [rawCompImage, rawOrigImage];

  const imageWidth = origImage.width;
  const imageHeight = origImage.height;

  const diffImage = new PNG({ width: imageWidth, height: imageHeight });

  const pixelCount = pixelmatch(
    compImage.data,
    origImage.data,
    diffImage.data,
    imageWidth,
    imageHeight,
    { threshold: 0 },
  );

  return {
    pixelCount,
    buffer: PNG.sync.write(diffImage),
  };
};
