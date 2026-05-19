// Snippet from Rob Dodson @ https://gist.github.com/robdodson/c2d3c4a6bf6bf9962893760c5585a3eb

let memo;

/**
 * Memoize a collection into a hash for faster lookups.
 * Important: Memoization assumes that all post slugs are unique.
 * @param {Array<Object>} collection A collection.
 * Typically collections.all
 * @return {Array<Object>} The original collection. We return this to make
 * the collection API happy since it expects a collection of some kind.
 */
const memoize = collection => {
  if (memo && Object.keys(memo).length) {
    console.warn(`Overwriting existing memoized collection!`);
  }

  memo = {};
  collection.forEach(item => {
    if (memo[item.template.parsed.name]) {
      throw new Error(`Found duplicate post slug: '${item.template.parsed.name}'`);
    }

    memo[item.template.parsed.name] = item;
  });

  // Return the collection unchanged.
  return collection;
};

/**
 * Look up a post by its slug.
 * Requires that the collection the post lives in has already been memoized.
 * @param {string} slug The post slug to look up.
 * @return {Object} A collection item.
 */
const findBySlug = slug => {
  if (!slug) {
    throw new Error(`slug is either null or undefined`);
  }

  if (!memo) {
    throw new Error(`No collection has been memoized yet.`);
  }

  const found = memo[slug];
  if (!found) {
    return null;
  }

  return found;
};

module.exports = { memoize, findBySlug };
