// Зведення валют до гривні. Курс долара — з налаштувань проєкту; інші валюти поки рахуються як є (з позначкою в інтерфейсі).
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function toUah(amount, currency, project) {
  const a = Number(amount) || 0;
  if (!currency || currency === 'UAH') return a;
  if (currency === 'USD') return a * Number(project?.usdRate || 42);
  return a;
}

module.exports = { toUah, round2 };
