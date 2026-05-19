module.exports = {
  /*
  Slightly hacky. The renderer does not support double layer pagination out of the box,
  so we suppress permalinks here and use pagination to generate author pages with multiple post pages under it.
  This means we manually build the link to the author pages in the template language.
  eg. /blog/author/{{ author.data.page.fileSlug }}
  */
  permalink: false,
};
