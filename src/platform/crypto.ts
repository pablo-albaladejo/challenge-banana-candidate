import { createHmac, timingSafeEqual } from 'node:crypto';
export function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
