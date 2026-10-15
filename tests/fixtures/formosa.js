// Synthetic UTF-8 fixtures only. No production HTML, cookies or nonces.
export const article = (id = 'JP-001', duration = '6 วัน 5 คืน') => `
<article class="tour-agent-loop-item">
  <span class="tour-no">${id}</span><h3 class="entry-title">ญี่ปุ่น หิมะ ❄️ เที่ยวสนุก 🗾</h3>
  <div class="tour-date-night">${duration}</div>
  <figure class="entry-image"><img src="https://example.test/banner.jpg"></figure>
  <a id="pdf-file" href="https://example.test/tour.pdf">PDF</a>
  <a id="word-file" href="https://example.test/tour.doc">DOC</a>
  <div class="tour-airline-start"><div class="air-row">
    <span class="airport-name">BKK - KIX</span><span class="flight">TG 622</span><span class="time">08:00 - 16:00</span>
  </div><div class="air-row">
    <span class="airport-name">KIX - HND</span><span class="flight">JL 12</span><span class="time">17:00 - 18:00</span>
  </div></div>
  <div class="tour-airline-back"><div class="air-row">
    <span class="airport-name">HND - BKK</span><span class="flight">TG 623</span><span class="time">19:00 - 23:00</span>
  </div></div>
  <table><tr><th>Header</th></tr><tr><td>ignore short row</td></tr><tr>
    <td>1</td><td>1–6 มกราคม 2570 🎉</td>
    <td><span class="tour-price-sale"><del>29,900</del><b>25,900</b></span></td>
    <td><span class="tour-price-sale"><del><span>24,900</span></del>22,900</span></td>
    <td><del>20,900</del>18,900</td><td>3,000 บาท</td><td>30</td><td>10</td><td>20 ที่ / รอคอนเฟิร์ม ✅</td><td>1,000+500</td>
  </tr><tr>
    <td>2</td><td>7–12 มกราคม 2570</td><td>31,900 บาท</td><td>28,900</td><td>25,900</td><td>4,000</td>
    <td>25</td><td>5</td><td>เต็ม</td><td>1,500+600</td>
  </tr></table>
  <table><tr><td>1</td><td>not a departure table</td><td>999</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td></tr></table>
</article>`;

export const noncePage = (nonce = 'fixture-nonce-1', headers = {}) => new Response(
  `<html><script>var other = {nonce: 'wrong'}; var agent_ajax_object = {"ajax_url":"https://formosajourneyland.co.th/wp-admin/admin-ajax.php","nonce":"${nonce}"};</script></html>`,
  { headers },
);
export const ajaxPage = (result = '', pagination = '') => Response.json({ result, pagination });
