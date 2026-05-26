(() => {
  const script = document.createElement("script");
  script.src = "/ui/js/legacy-app.js";
  script.defer = false;
  document.currentScript.after(script);
})();
