// confirm-modal.js — one reusable Instrument-styled confirmation dialog.
// Replaces native window.confirm() across the hub. Vanilla ES module, no deps.
//
// Contract — opt a form into confirmation with data attributes:
//   <form ... data-confirm="Are you sure?"        (required: the message; opens the modal)
//            data-confirm-title="Please confirm"  (optional: dialog heading)
//            data-confirm-ok="Confirm">           (optional: confirm-button label)
// On submit of any such form we prevent the native submit, show the modal, and
// only proceed (form.submit(), which does NOT re-fire the submit event) once the
// user confirms. Cancel / Esc / backdrop click closes without submitting.

const DEFAULT_TITLE = 'Please confirm';
const DEFAULT_OK = 'Confirm';

let els = null; // cached modal elements once built
let pendingForm = null; // the form awaiting confirmation
let lastFocused = null; // element to restore focus to on close

// Build the single modal DOM structure and append it to <body> (hidden).
function build() {
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML =
    `<div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg">` +
    `<h2 class="confirm-title" id="confirm-title"></h2>` +
    `<p class="confirm-msg" id="confirm-msg"></p>` +
    `<div class="confirm-actions">` +
    `<button type="button" class="btn btn-ghost confirm-cancel"></button>` +
    `<button type="button" class="btn btn-danger confirm-ok"></button>` +
    `</div></div>`;
  document.body.appendChild(backdrop);

  els = {
    backdrop,
    dialog: backdrop.querySelector('.confirm-dialog'),
    title: backdrop.querySelector('.confirm-title'),
    msg: backdrop.querySelector('.confirm-msg'),
    cancel: backdrop.querySelector('.confirm-cancel'),
    ok: backdrop.querySelector('.confirm-ok'),
  };

  els.cancel.addEventListener('click', close);
  els.ok.addEventListener('click', accept);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  return els;
}

function isOpen() {
  return els && !els.backdrop.hidden;
}

// Focus trap: keep Tab within the dialog; Esc closes.
function onKeydown(e) {
  if (!isOpen()) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = [els.cancel, els.ok];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function open(form) {
  if (!els) build();
  pendingForm = form;
  lastFocused = document.activeElement;

  els.title.textContent = form.getAttribute('data-confirm-title') || DEFAULT_TITLE;
  els.msg.textContent = form.getAttribute('data-confirm') || '';
  els.ok.textContent = form.getAttribute('data-confirm-ok') || DEFAULT_OK;
  els.cancel.textContent = 'Cancel';

  els.ok.disabled = false;
  els.backdrop.hidden = false;
  els.backdrop.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKeydown, true);
  // Default focus to Cancel (safer default for destructive actions).
  els.cancel.focus();
}

function close() {
  if (!els) return;
  els.backdrop.classList.remove('is-open');
  els.backdrop.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKeydown, true);
  pendingForm = null;
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  lastFocused = null;
}

function accept() {
  const form = pendingForm;
  // Guard against double-activation in the pre-navigation window.
  if (els) els.ok.disabled = true;
  close();
  // form.submit() does NOT fire the submit event, so it won't be re-intercepted.
  if (form) form.submit();
}

// Single capturing submit listener: intercept any opted-in form.
function onSubmit(e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.hasAttribute('data-confirm')) return;
  e.preventDefault();
  e.stopPropagation();
  open(form);
}

if (typeof document !== 'undefined') {
  document.addEventListener('submit', onSubmit, true);
}
