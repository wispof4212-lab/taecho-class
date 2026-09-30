/* Photo-only OMR reader. The Anthropic key is held by the Supabase function. */
async function readOmrViaServer(file, user) {
  if (!file || !user || !user.id || !user.pw) throw new Error('로그인 정보를 다시 확인해 주세요.');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('JPG·PNG·WebP 사진만 올릴 수 있어요.');
  const url = URL.createObjectURL(file);
  let image;
  try {
    image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('사진을 열지 못했어요.'));
      img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
  const ratio = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * ratio);
  canvas.height = Math.round(image.naturalHeight * ratio);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageBase64 = canvas.toDataURL('image/jpeg', 0.90).split(',')[1];
  if (imageBase64.length > 6_000_000) throw new Error('사진 용량이 너무 커요. JPG로 다시 찍어 주세요.');
  const response = await fetch(SB_URL + '/functions/v1/omr-read', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'apikey': SB_KEY,
    },
    body: JSON.stringify({ userId: user.id, password: user.pw, imageBase64 }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      not_configured: '사진 판독 연결이 아직 준비되지 않았어요.',
      unauthorized: '로그인 정보가 맞지 않아요. 다시 로그인해 주세요.',
      quota_exceeded: '오늘의 사진 판독 한도에 도달했어요. 선생님께 알려 주세요.',
      quota_unavailable: '사진 판독 서버에 잠시 문제가 있어요.',
      image_too_large: '사진 용량이 너무 커요. 다시 찍어 주세요.',
      provider_unavailable: 'AI 판독 서버가 응답하지 않았어요. 잠시 후 다시 시도해 주세요.',
      unreadable_response: 'AI가 마킹을 확실히 읽지 못했어요. 다시 찍어 주세요.',
    };
    throw new Error(messages[result.error] || '사진 판독에 실패했어요.');
  }
  if (!/^[0-5]{45}$/.test(result.marks || '')) throw new Error('마킹 결과가 올바르지 않아요.');
  const answers = [...result.marks].map(value => value === '0' ? '' : value);
  return {
    answers,
    readCount: answers.filter(Boolean).length,
    fingerprint: String(result.fingerprint || ''),
    track: result.track === '화작' || result.track === '언매' ? result.track : null,
  };
}
