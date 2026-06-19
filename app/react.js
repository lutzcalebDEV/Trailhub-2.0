// Vale Trails — React/htm bindings.
// The UMD bundles in /vendor set window.React, window.ReactDOM and window.htm.
// We expose them as ES-module exports so the rest of the app can `import` cleanly
// while staying 100% build-free.
export const React = window.React;
export const ReactDOM = window.ReactDOM;
export const html = window.htm.bind(React.createElement);
export const createPortal = window.ReactDOM.createPortal;
export const {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useLayoutEffect,
  Fragment,
} = React;
