const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

function renderResponsiveImage({
  srcPath,
  urlPath,
  outputDir,
  widths,
  formats,
  attributes = {},
  imageJobs,
  sharpOptions = {},
}) {
  const extension = path.extname(srcPath);
  const sourceFormat = extension.replace(".", "").toLowerCase();
  const name = path.basename(srcPath, extension);
  const normalizedUrlPath = normalizeUrlPath(urlPath);
  const normalizedFormats = formats?.length ? formats : [sourceFormat];
  const normalizedWidths = widths?.length ? widths.map(Number) : [null];

  if (sourceFormat === "svg") {
    const destination = path.join(outputDir, `${name}.svg`);
    schedule(imageJobs, copyFile(srcPath, destination));
    return renderImg({
      src: `${normalizedUrlPath}/${name}.svg`,
      attributes,
    });
  }

  const sources = normalizedFormats.map(format => {
    const srcset = normalizedWidths
      .map(width => {
        const filename = `${name}@${width}.${normalizeExtension(format)}`;
        const destination = path.join(outputDir, filename);
        schedule(
          imageJobs,
          writeVariant({
            srcPath,
            destination,
            width,
            format,
            sharpOptions,
          })
        );
        return `${normalizedUrlPath}/${filename} ${width}w`;
      })
      .join(", ");

    return {
      format,
      srcset,
      src: `${normalizedUrlPath}/${name}@${normalizedWidths[0]}.${normalizeExtension(format)}`,
    };
  });

  const fallback = sources[sources.length - 1];
  const sourceMarkup = sources
    .slice(0, -1)
    .map(
      source =>
        `<source type="image/${mimeType(source.format)}" srcset="${escapeAttribute(source.srcset)}" sizes="${escapeAttribute(
          attributes.sizes || "100vw"
        )}">`
    )
    .join("");

  return `<picture>${sourceMarkup}${renderImg({
    src: fallback.src,
    srcset: fallback.srcset,
    attributes,
  })}</picture>`;
}

async function writeVariant({ srcPath, destination, width, format, sharpOptions }) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  let pipeline = sharp(srcPath, sharpOptions).resize({
    width,
    withoutEnlargement: true,
  });

  if (format === "jpg" || format === "jpeg") {
    pipeline = pipeline.jpeg();
  } else {
    pipeline = pipeline.toFormat(format);
  }

  await pipeline.toFile(destination);
}

async function copyFile(srcPath, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await fs.promises.copyFile(srcPath, destination);
}

function renderImg({ src, srcset, attributes }) {
  const renderedAttributes = [
    ["src", src],
    srcset ? ["srcset", srcset] : null,
    ["sizes", attributes.sizes],
    ["class", attributes.class],
    ["alt", attributes.alt ?? ""],
    ["loading", attributes.loading],
    ["decoding", attributes.decoding],
  ]
    .filter(attribute => attribute && attribute[1] !== undefined && attribute[1] !== null)
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(" ");

  return `<img ${renderedAttributes}>`;
}

function schedule(imageJobs, promise) {
  if (imageJobs) {
    imageJobs.push(promise);
  }
}

function normalizeUrlPath(value) {
  return value.replace(/\\/g, "/").replace(/\/$/, "");
}

function normalizeExtension(format) {
  return format === "jpeg" ? "jpg" : format;
}

function mimeType(format) {
  if (format === "jpg") {
    return "jpeg";
  }
  return format;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { renderResponsiveImage };
