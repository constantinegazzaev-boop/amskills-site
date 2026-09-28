// Хедер — тёмный фон при скролле
const siteHeader = document.querySelector('.site-header');
if (siteHeader) {
  const toggleHeader = () => {
    siteHeader.classList.toggle('is-scrolled', window.scrollY > 40);
  };
  toggleHeader();
  window.addEventListener('scroll', toggleHeader, { passive: true });
}

// Плавное появление элементов при скролле
const animatedEls = document.querySelectorAll('[data-animate]');
if (animatedEls.length && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
  );
  animatedEls.forEach((el) => observer.observe(el));
} else {
  animatedEls.forEach((el) => el.classList.add('is-visible'));
}

// Мобильное меню
const burger = document.getElementById('burger');
const nav = document.getElementById('nav');

if (burger && nav) {
  burger.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
}

// Оплата — разовый платёж через Т-Кассу
const paymentForm = document.getElementById('payment-form');

if (paymentForm) {
  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const amountInput = document.getElementById('payment-amount');
    const descriptionInput = document.getElementById('payment-description');
    const submitBtn = paymentForm.querySelector('button[type="submit"]');

    let statusEl = paymentForm.querySelector('.payment-status');
    if (!statusEl) {
      statusEl = document.createElement('p');
      statusEl.className = 'payment-status';
      paymentForm.appendChild(statusEl);
    }
    statusEl.classList.remove('error');
    statusEl.textContent = '';

    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) {
      statusEl.textContent = 'Укажите сумму больше нуля.';
      statusEl.classList.add('error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Переходим к оплате…';

    try {
      const res = await fetch('/api/payment-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          description: descriptionInput.value || 'Оплата тренировки — Антон Минаев',
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.paymentUrl) {
        throw new Error(data.error || 'Не удалось создать платёж');
      }

      window.location.href = data.paymentUrl;
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message + '. Попробуйте ещё раз или позвоните нам.';
      statusEl.classList.add('error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Оплатить';
    }
  });
}
