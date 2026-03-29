export function toHttps(url) {
  if (!url) return '';
  // KOPIS 이미지는 weserv.nl 프록시로 우회
  if (url.includes('kopis.or.kr') || url.includes('interpark.com')) {
    const cleanUrl = url.replace(/^https?:\/\//, '');
    return `https://images.weserv.nl/?url=${cleanUrl}`;
  }
  return url.replace(/^http:\/\//, 'https://');
}
