module.exports = {
  layout: "workshop",
  computed: {
    permalink: function (data) {
      return `/services/workshops/${data.page.fileSlug}/`;
    },
  },
};
