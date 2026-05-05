const LANG_MAP = {
  vi: 'tiếng Việt',
  en: 'English',
  auto: null,
}

const TONE_MAP = {
  friendly: 'thân thiện, gần gũi',
  youthful: 'trẻ trung, năng động, dùng từ ngữ Gen Z',
  serious: 'nghiêm túc, chỉn chu',
  humorous: 'hài hước, dí dỏm',
  professional: 'chuyên nghiệp, lịch sự',
}

export async function generateReply({ apiKey, model, postText, replyText, language = 'vi', tone = 'friendly' }) {
  const langLabel = LANG_MAP[language]
  const toneLabel = TONE_MAP[tone] || TONE_MAP.friendly

  const langInstruction = langLabel
    ? `Trả lời bằng ${langLabel}.`
    : 'Trả lời bằng ngôn ngữ giống với reply gốc.'

  const systemPrompt = `Bạn là trợ lý viết reply cho mạng xã hội Threads. ${langInstruction} Giọng điệu: ${toneLabel}. Viết reply ngắn gọn, tự nhiên, phù hợp ngữ cảnh. Chỉ trả về nội dung reply, không giải thích, không dùng dấu ngoặc kép bao quanh.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Bài post gốc: "${postText}"\nReply cần trả lời: "${replyText}"\nViết 1 reply phù hợp.` }
      ],
      max_tokens: 200,
    })
  })
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}
