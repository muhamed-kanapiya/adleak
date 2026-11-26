// "Live chat" widget from a third-party vendor. Loaded synchronously in <head>.
(function () {
  function mount() {
    var b = document.createElement('a');
    b.href = 'https://wa.me/77170000000';
    b.className = 'chat-bubble';
    b.textContent = '💬';
    b.setAttribute('aria-label', 'Chat on WhatsApp');
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
