(() => {
  const sorting = document.createElement("script");
  sorting.src = "/ui/js/core/list-sorting.js";
  sorting.async = false;
  sorting.defer = false;
  document.currentScript.after(sorting);
  const script = document.createElement("script");
  script.src = "/ui/js/legacy-app.js";
  script.async = false;
  script.defer = false;
  sorting.after(script);
})();
