(() => {
  'use strict';

  /* ============================================================
     1. ЭКРАН «ИМЯ + ПОЛ»
     ============================================================ */

  const entryScreen = document.getElementById('entry-screen');
  const entryForm = document.getElementById('entry-form');
  const nameInput = document.getElementById('guest-name');
  const genderButtons = Array.from(document.querySelectorAll('.gender-btn'));
  const goBtn = entryForm.querySelector('.go-arrow-btn');
  const landing = document.getElementById('landing');

  const STORAGE_KEY = 'birthday-invite-guest';

  let guest = { name: '', gender: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.name && saved.gender) guest = saved;
  } catch (e) { /* ignore */ }

  function refreshGoState() {
    const ok = nameInput.value.trim().length > 0 && !!guest.gender;
    goBtn.disabled = !ok;
  }

  genderButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      genderButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      guest.gender = btn.dataset.gender;
      refreshGoState();
    });
  });

  nameInput.addEventListener('input', refreshGoState);

  // восстановление сохранённых данных (если пользователь уже открывал сайт)
  if (guest.name) nameInput.value = guest.name;
  if (guest.gender) {
    const match = genderButtons.find(b => b.dataset.gender === guest.gender);
    if (match) match.classList.add('selected');
  }
  refreshGoState();

  entryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    guest.name = nameInput.value.trim();
    if (!guest.name || !guest.gender) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(guest)); } catch (e) {}
    openLanding();
  });

  function openLanding() {
    // подставляем сохранённое имя в поле RSVP
    const rsvpNameInput = document.getElementById('rsvp-name');
    if (rsvpNameInput && !rsvpNameInput.value) rsvpNameInput.value = guest.name;

    entryScreen.classList.add('hidden');
    landing.classList.remove('hidden');
    window.scrollTo(0, 0);

    initScrollReveal();
    initScrollProgress();
    refreshGuestCounter();
  }

  /* ============================================================
     1b. ПОЛОСА ПРОГРЕССА ПРОКРУТКИ
     ============================================================ */

  function initScrollProgress() {
    const bar = document.getElementById('scroll-progress');
    if (!bar) return;

    function update() {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const pct = height > 0 ? (scrollTop / height) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }

    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ============================================================
     1c. СЧЁТЧИК ПОДТВЕРДИВШИХ ГОСТЕЙ
     ============================================================ */

  async function refreshGuestCounter() {
    const counter = document.getElementById('guest-counter');
    const counterNum = document.getElementById('guest-counter-num');
    if (!counter || !counterNum) return;

    try {
      const res = await fetch('/api/guests');
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      const count = Array.isArray(data.confirmed) ? data.confirmed.length : 0;
      if (count > 0) {
        counterNum.textContent = count;
        counter.classList.remove('hidden');
      } else {
        counter.classList.add('hidden');
      }
    } catch (err) {
      // сервер недоступен (например, сайт открыт как локальный файл) — просто скрываем счётчик
      counter.classList.add('hidden');
    }
  }

  /* ============================================================
     2. АНИМАЦИИ ПРИ ПРОКРУТКЕ (обычный скролл, без перелистывания)
     ============================================================ */

  function initScrollReveal() {
    const chapters = Array.from(landing.querySelectorAll('.chapter'));
    const revealEls = Array.from(landing.querySelectorAll('.reveal'));

    if (!('IntersectionObserver' in window)) {
      // на случай очень старого браузера — просто показываем всё сразу
      chapters.forEach(c => c.classList.add('in-view'));
      revealEls.forEach(r => r.classList.add('in-view'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.28 });

    chapters.forEach(c => observer.observe(c));
    revealEls.forEach(r => observer.observe(r));
  }

  /* ============================================================
     3. ФОРМА ОБРАТНОЙ СВЯЗИ (RSVP)
     ============================================================ */

  const rsvpForm = document.getElementById('rsvp-form');
  const rsvpThanks = document.getElementById('rsvp-thanks');
  const rsvpThanksText = document.getElementById('rsvp-thanks-text');
  const trackField = document.getElementById('track-field');
  const trackInput = document.getElementById('rsvp-track');
  const attendingRadios = Array.from(rsvpForm.querySelectorAll('input[name="attending"]'));

  attendingRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const showTrack = radio.checked && radio.value === 'yes';
      if (showTrack) {
        trackField.classList.remove('hidden');
      } else if (radio.checked) {
        trackField.classList.add('hidden');
        trackInput.value = '';
      }
    });
  });

  rsvpForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = rsvpForm.querySelector('.rsvp-submit');
    const name = rsvpForm.querySelector('#rsvp-name').value.trim();
    const attendingValue = rsvpForm.querySelector('input[name="attending"]:checked');
    if (!name || !attendingValue) return;

    const attending = attendingValue.value === 'yes';
    const track = attending ? trackInput.value.trim() : '';
    const payload = {
      name,
      gender: guest.gender || '',
      attending,
      track,
      timestamp: new Date().toISOString()
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляем…';

    let ok = false;
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      ok = res.ok;
    } catch (err) {
      ok = false;
    }

    if (!ok) {
      // запасной вариант — сохраняем ответ локально, чтобы он не потерялся
      try {
        const key = 'birthday-invite-rsvp-fallback';
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        list.push(payload);
        localStorage.setItem(key, JSON.stringify(list));
      } catch (err) {}
    }

    rsvpThanksText.textContent = attending
      ? (track
          ? 'Спасибо! Твой трек обязательно прозвучит ' + '\u2728'
          : 'Спасибо! Очень жду встречи с тобой ' + '\u2728')
      : 'Жаль, что не получится — но спасибо, что сообщил(а)!';

    rsvpForm.classList.add('hidden');
    rsvpThanks.classList.remove('hidden');

    if (ok) refreshGuestCounter();
    if (attending) launchConfetti();
  });

  /* ============================================================
     4. КОНФЕТТИ (единственный праздничный "wow"-момент — только
     при подтверждении присутствия, чистый CSS + JS, без канваса)
     ============================================================ */

  function launchConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const colors = ['#e88baa', '#c5537a', '#f3c9d8', '#c79a5c', '#ecd6a6', '#ffffff'];
    const count = 60;

    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';

      const size = 6 + Math.random() * 6;
      const left = Math.random() * 100;
      const duration = 2.6 + Math.random() * 1.6;
      const delay = Math.random() * 0.4;
      const drift = (Math.random() - 0.5) * 220;
      const spin = 360 + Math.random() * 360;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const isCircle = Math.random() > 0.5;

      piece.style.left = left + 'vw';
      piece.style.width = size + 'px';
      piece.style.height = (isCircle ? size : size * 1.6) + 'px';
      piece.style.background = color;
      piece.style.borderRadius = isCircle ? '50%' : '2px';
      piece.style.setProperty('--drift', drift + 'px');
      piece.style.setProperty('--spin', spin + 'deg');
      piece.style.animationDuration = duration + 's';
      piece.style.animationDelay = delay + 's';

      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
    }
  }

})();