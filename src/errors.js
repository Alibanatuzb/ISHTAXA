'use strict';

/* Mijozga koʻrsatish uchun xavfsiz xato. Boshqa xatolar mijozga umuman koʻrsatilmaydi. */
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

module.exports = { HttpError };
