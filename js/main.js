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
          description: descriptionInput.value || 'Оплата тренировки AMSkills',
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
