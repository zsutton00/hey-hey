import { ANNOTATION_COLORS } from '../../../../packages/ui-common/src/utils/annotationColors';

export const ANNOTATION_BINDING = '__heyheyAnnotate';
export const ANNOTATION_SYNC_EVENT = '__heyhey-annotations-sync';

/**
 * Init script for every document in the shared browser's context. It runs
 * before any page script and stays hidden until the CLI confirms the page
 * belongs to a Run.
 *
 * Kept as plain JavaScript: a serialized TypeScript function would carry
 * transpiler helpers (tsx's `__name`) that do not exist in the page.
 */
export const annotationOverlaySource = (nonce: string): string =>
  OVERLAY_SCRIPT.replace('__CONFIG__', () =>
    JSON.stringify({
      binding: ANNOTATION_BINDING,
      syncEvent: ANNOTATION_SYNC_EVENT,
      nonce,
      colors: ANNOTATION_COLORS,
    }),
  );

const OVERLAY_SCRIPT = String.raw`(function (config) {
  'use strict';
  if (window.top !== window) return;
  var call = window[config.binding];
  if (typeof call !== 'function') return;
  // Page scripts run later and must not find the binding.
  delete window[config.binding];

  var owned = false;
  var picking = false;
  var markers = [];
  var total = 0;
  var editing = null;
  var hovered = null;
  var located = new Map();

  var host = document.createElement('heyhey-annotations');
  host.setAttribute('style', 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;');
  var root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>' +
    ':host { all: initial; }' +
    '* { box-sizing: border-box; font: 12px/1.4 system-ui, sans-serif; }' +
    '.box { position: fixed; pointer-events: none; border: 2px solid #2563eb; border-radius: 3px; background: rgba(37, 99, 235, 0.08); }' +
    '.hover { border-style: dashed; }' +
    '.badge { position: fixed; pointer-events: auto; cursor: pointer; min-width: 20px; height: 20px; padding: 0 5px; border: none; border-radius: 10px; background: #2563eb; color: #fff; font-weight: 600; text-align: center; transform: translate(-50%, -50%); }' +
    '.toolbar { position: fixed; right: 16px; top: 16px; pointer-events: auto; display: flex; gap: 6px; align-items: center; padding: 6px; border-radius: 8px; background: ' + config.colors.main + '; color: ' + config.colors.contrastText + '; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }' +
    '.toolbar button { cursor: pointer; position: relative; padding: 4px 8px; border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 5px; background: rgba(255, 255, 255, 0.12); color: inherit; }' +
    '.toolbar button[aria-pressed="true"] { background: #fff; border-color: #fff; color: ' + config.colors.main + '; }' +
    '.toolbar button:disabled { opacity: 0.5; cursor: default; }' +
    '.toolbar button[data-tip]:hover::after { content: attr(data-tip); position: absolute; right: 0; top: calc(100% + 8px); width: max-content; max-width: 260px; white-space: normal; padding: 6px 8px; border-radius: 4px; background: #111827; color: #f9fafb; pointer-events: none; }' +
    '.count { position: absolute; top: -8px; right: -8px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #111827; color: #fff; font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; }' +
    '.count:empty { display: none; }' +
    '.popover button { cursor: pointer; padding: 4px 8px; border: 1px solid #4b5563; border-radius: 5px; background: #1f2937; color: inherit; }' +
    '.list { position: fixed; right: 16px; top: 64px; pointer-events: auto; width: 300px; max-height: 50vh; overflow-y: auto; padding: 6px; border-radius: 8px; background: #111827; color: #f9fafb; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }' +
    '.list button { display: flex; gap: 8px; width: 100%; padding: 6px; border: none; border-radius: 5px; background: none; color: inherit; text-align: left; cursor: pointer; }' +
    '.list button:hover { background: #1f2937; }' +
    '.list .number { flex: none; min-width: 20px; height: 20px; border-radius: 10px; background: #2563eb; font-weight: 600; line-height: 20px; text-align: center; }' +
    '.list .empty { padding: 6px; opacity: 0.7; }' +
    '.popover { position: fixed; pointer-events: auto; width: 260px; padding: 8px; border-radius: 8px; background: #111827; color: #f9fafb; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }' +
    '.popover textarea { width: 100%; height: 64px; margin-bottom: 6px; padding: 4px; border-radius: 4px; border: 1px solid #4b5563; background: #1f2937; color: inherit; resize: vertical; }' +
    '.actions { display: flex; gap: 6px; justify-content: flex-end; }' +
    '</style>' +
    '<div class="layer"></div>' +
    '<div class="toolbar">' +
    '<button class="pick" aria-pressed="false">Annotate</button>' +
    '<button class="all" aria-pressed="false" data-tip="View the comments on this page">View comments<span class="count"></span></button>' +
    '<button class="clear" data-tip="Remove all annotations">Clear</button>' +
    '</div>';
  var layer = root.querySelector('.layer');
  var pickButton = root.querySelector('.pick');
  var count = root.querySelector('.count');
  var clearButton = root.querySelector('.clear');
  var allButton = root.querySelector('.all');
  var listing = false;

  // A refused list means the page belongs to no Run; a refused change re-reads the list.
  function send(message) {
    return Promise.resolve()
      .then(function () { return call({ nonce: config.nonce, message: message }); })
      .then(function (reply) {
        owned = true;
        total = reply.total;
        markers = reply.annotations;
      }, function () {
        if (message.op !== 'list') return send({ op: 'list' });
        owned = false;
        picking = false;
        total = 0;
        markers = [];
      })
      .then(function () {
        if (editing !== null && !markers.some(function (m) { return m.id === editing; })) editing = null;
        render();
      });
  }

  // --- Element description ---------------------------------------------------

  var TAG_ROLES = {
    button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', nav: 'navigation',
    main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary', form: 'form',
    ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell',
    th: 'columnheader', dialog: 'dialog', p: 'paragraph', summary: 'button'
  };
  var NAMED_FROM_CONTENT = ['button', 'link', 'heading', 'checkbox', 'radio', 'tab', 'menuitem',
    'option', 'cell', 'columnheader', 'listitem'];

  function implicitRole(element) {
    var tag = element.tagName.toLowerCase();
    if (tag === 'a' || tag === 'area') return element.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'input') {
      var type = (element.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (['button', 'submit', 'reset', 'image'].indexOf(type) >= 0) return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return Object.prototype.hasOwnProperty.call(TAG_ROLES, tag) ? TAG_ROLES[tag] : 'generic';
  }
  function roleOf(element) {
    var explicit = (element.getAttribute('role') || '').trim().split(/\s+/)[0];
    return explicit || implicitRole(element);
  }
  function collapse(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }
  function nameOf(element) {
    var label = collapse(element.getAttribute('aria-label'));
    if (label) return label;
    var labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      var referenced = collapse(labelledBy.split(/\s+/).map(function (id) {
        var target = document.getElementById(id);
        return target ? target.textContent : '';
      }).join(' '));
      if (referenced) return referenced;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement) {
      var labels = collapse(Array.prototype.map.call(element.labels || [], function (entry) {
        return entry.textContent;
      }).join(' '));
      if (labels) return labels;
      if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].indexOf(element.type) >= 0)
        return collapse(element.value);
      var placeholder = collapse(element.getAttribute('placeholder'));
      if (placeholder) return placeholder;
    }
    if (element instanceof HTMLImageElement) return collapse(element.alt);
    if (NAMED_FROM_CONTENT.indexOf(roleOf(element)) >= 0) return collapse(element.textContent);
    return collapse(element.getAttribute('title'));
  }
  function visibleText(element) {
    var text = element instanceof HTMLElement ? collapse(element.innerText) : collapse(element.textContent);
    return (text || nameOf(element)).slice(0, 300);
  }
  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (error) {
      return false;
    }
  }
  function roleMatches(role, name) {
    return Array.prototype.filter.call(document.querySelectorAll('*'), function (candidate) {
      return candidate !== host && roleOf(candidate) === role && nameOf(candidate) === name;
    });
  }
  function structuralPath(element) {
    var steps = [];
    var current = element;
    while (current && current !== document.documentElement) {
      if (current.id && isUnique('#' + CSS.escape(current.id))) {
        steps.unshift('#' + CSS.escape(current.id));
        break;
      }
      var parent = current.parentElement;
      var tagName = current.tagName;
      var position = parent
        ? Array.prototype.filter.call(parent.children, function (sibling) {
            return sibling.tagName === tagName;
          }).indexOf(current) + 1
        : 1;
      steps.unshift(tagName.toLowerCase() + ':nth-of-type(' + position + ')');
      current = parent;
    }
    return steps.join(' > ');
  }
  // Preference: test ID, then ID, then role and accessible name, then structure.
  function selectorFor(element) {
    var testId = element.getAttribute('data-testid');
    if (testId && isUnique('[data-testid=' + JSON.stringify(testId) + ']'))
      return '[data-testid=' + JSON.stringify(testId) + ']';
    if (element.id && isUnique('#' + CSS.escape(element.id))) return '#' + CSS.escape(element.id);
    var role = roleOf(element);
    var name = nameOf(element);
    if (role !== 'generic' && name && name.length <= 200 && roleMatches(role, name).length === 1)
      return 'role=' + role + '[name=' + JSON.stringify(name) + ' s]';
    return structuralPath(element);
  }
  function locate(selector) {
    var cached = located.get(selector);
    if (cached && cached.isConnected) return cached;
    var found = null;
    var byRole = /^role=([a-z]+)\[name=(".*") s\]$/.exec(selector);
    if (byRole) {
      found = roleMatches(byRole[1], JSON.parse(byRole[2]))[0] || null;
    } else {
      try {
        found = document.querySelector(selector);
      } catch (error) {
        found = null;
      }
    }
    if (found) located.set(selector, found);
    else located.delete(selector);
    return found;
  }

  // --- Drawing -----------------------------------------------------------------

  function place(element, rect) {
    element.style.left = rect.left + 'px';
    element.style.top = rect.top + 'px';
    element.style.width = rect.width + 'px';
    element.style.height = rect.height + 'px';
  }
  function openNote() {
    var textarea = layer.querySelector('textarea');
    return textarea ? textarea.value.slice(0, 2000) : null;
  }
  // Saves a note the user typed but did not save before moving on.
  function commitOpenNote() {
    var value = openNote();
    var marker = markers.find(function (m) { return m.id === editing; });
    editing = null;
    if (marker && value !== null && value !== marker.note)
      return send({ op: 'update', id: marker.id, note: value });
    render();
    return Promise.resolve();
  }
  function appendEditor(marker, anchor, draft) {
    var popover = document.createElement('div');
    popover.className = 'popover';
    popover.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - 276)) + 'px';
    popover.style.top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - 130)) + 'px';
    var textarea = document.createElement('textarea');
    textarea.placeholder = 'Note for annotation ' + marker.number + ' (optional)';
    textarea.value = draft === null ? marker.note : draft;
    var actions = document.createElement('div');
    actions.className = 'actions';
    var remove = document.createElement('button');
    remove.textContent = 'Remove';
    var save = document.createElement('button');
    save.textContent = 'Save';
    actions.append(remove, save);
    popover.append(textarea, actions);
    save.addEventListener('click', function () { void commitOpenNote(); });
    remove.addEventListener('click', function () {
      editing = null;
      void send({ op: 'remove', id: marker.id });
    });
    textarea.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void commitOpenNote();
      }
    });
    layer.append(popover);
    textarea.focus();
  }
  function render() {
    if (!owned) {
      host.remove();
      return;
    }
    if (!host.isConnected) document.documentElement.append(host);
    pickButton.setAttribute('aria-pressed', String(picking));
    pickButton.setAttribute('data-tip', picking
      ? 'Stop selecting elements (Esc)'
      : 'Select any element to add a comment. Your comments are sent with your next message to the agent session that opened this tab.');
    count.textContent = total > 0 ? String(total) : '';
    if (total === 0) listing = false;
    allButton.disabled = total === 0;
    clearButton.disabled = total === 0;
    allButton.setAttribute('aria-pressed', String(listing));
    var draft = openNote();
    layer.replaceChildren();
    if (picking && hovered && hovered.isConnected) {
      var hover = document.createElement('div');
      hover.className = 'box hover';
      place(hover, hovered.getBoundingClientRect());
      layer.append(hover);
    }
    markers.forEach(function (marker) {
      var element = locate(marker.selector);
      if (!element) return;
      var rect = element.getBoundingClientRect();
      var box = document.createElement('div');
      box.className = 'box';
      place(box, rect);
      var badge = document.createElement('button');
      badge.className = 'badge';
      badge.textContent = String(marker.number);
      badge.title = marker.note || 'Add a note';
      badge.style.left = rect.left + 'px';
      badge.style.top = rect.top + 'px';
      badge.addEventListener('click', function () {
        if (editing === marker.id) {
          void commitOpenNote();
          return;
        }
        void commitOpenNote().then(function () {
          editing = marker.id;
          render();
        });
      });
      layer.append(box, badge);
      if (editing === marker.id) appendEditor(marker, rect, draft);
    });
    if (listing) appendList();
  }
  // Lists this page's annotations; choosing one scrolls to it and opens its note.
  function appendList() {
    var list = document.createElement('div');
    list.className = 'list';
    if (markers.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No comments on this page';
      list.append(empty);
    }
    markers.forEach(function (marker) {
      var item = document.createElement('button');
      var number = document.createElement('span');
      number.className = 'number';
      number.textContent = String(marker.number);
      var label = document.createElement('span');
      label.textContent = marker.note || '(no note)';
      item.append(number, label);
      item.addEventListener('click', function () {
        listing = false;
        var element = locate(marker.selector);
        if (element) element.scrollIntoView({ block: 'center' });
        void commitOpenNote().then(function () {
          editing = marker.id;
          render();
        });
      });
      list.append(item);
    });
    layer.append(list);
  }
  var frameRequested = false;
  function scheduleRender() {
    if (!owned || frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(function () {
      frameRequested = false;
      render();
    });
  }

  // --- Picker --------------------------------------------------------------------

  // Any event whose path crosses the host comes from the overlay's own controls.
  function fromPage(event) {
    if (!picking || !event.isTrusted) return null;
    var path = event.composedPath();
    var target = path[0];
    if (!(target instanceof Element) || path.indexOf(host) >= 0) return null;
    return target;
  }
  function block(event) {
    if (!fromPage(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick', 'contextmenu']
    .forEach(function (type) { window.addEventListener(type, block, true); });
  window.addEventListener('click', function (event) {
    var element = fromPage(event);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hovered = null;
    var annotation = {
      selector: selectorFor(element).slice(0, 1000),
      role: roleOf(element).slice(0, 100),
      text: visibleText(element),
      note: ''
    };
    var anchored = element.closest('[data-hh-id]');
    var elementId = anchored ? (anchored.getAttribute('data-hh-id') || '').slice(0, 200) : '';
    if (elementId) annotation.elementId = elementId;
    void commitOpenNote().then(function () {
      var before = new Set(markers.map(function (m) { return m.id; }));
      return send({ op: 'add', annotation: annotation }).then(function () {
        var added = markers.find(function (m) { return !before.has(m.id); });
        editing = added ? added.id : null;
        render();
      });
    });
  }, true);
  window.addEventListener('pointermove', function (event) {
    var element = fromPage(event);
    if (!element || element === hovered) return;
    hovered = element;
    scheduleRender();
  }, true);
  window.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !owned || (!picking && editing === null)) return;
    picking = false;
    hovered = null;
    void commitOpenNote();
  }, true);
  // Typing a note must not trigger the page's own keyboard shortcuts.
  ['keydown', 'keyup', 'keypress'].forEach(function (type) {
    host.addEventListener(type, function (event) { event.stopPropagation(); });
  });

  pickButton.addEventListener('click', function () {
    picking = !picking;
    hovered = null;
    render();
  });
  allButton.addEventListener('click', function () {
    listing = !listing;
    render();
  });
  clearButton.addEventListener('click', function () {
    editing = null;
    void send({ op: 'clear' });
  });

  window.addEventListener('scroll', scheduleRender, { capture: true, passive: true });
  window.addEventListener('resize', scheduleRender, { passive: true });
  // Page content moves without scrolling; keep markers on their elements.
  setInterval(function () {
    if (owned && editing === null && (markers.length > 0 || !host.isConnected)) scheduleRender();
  }, 500);
  window.addEventListener(config.syncEvent, function () { void send({ op: 'list' }); });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', function () { void send({ op: 'list' }); }, { once: true });
  else void send({ op: 'list' });
})(__CONFIG__);`;
