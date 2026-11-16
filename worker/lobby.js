// Pencari meja Ranked: satu Durable Object global ("main"). Menaruh pemain di meja Ranked yang masih bisa dimasuki
// (per taruhan), atau membuat meja baru. Menjaga satu akun hanya duduk di satu meja Ranked.
import { DurableObject } from 'cloudflare:workers';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => [...crypto.getRandomValues(new Uint8Array(5))].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
/** Kunci rahasia kursi: hanya diberikan ke pemain yang kursinya dipesan. */
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => (x % 36).toString(36)).join('');

export class CapsaLobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = { open: {}, active: {} }; // open: taruhan -> kode meja yang masih menerima pemain; active: id akun -> kode meja
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) || this.state;
    });
  }

  room(code) {
    return this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
  }

  /** user = { userId, name, avatar, coins } (sudah diverifikasi). six = jumlah pemain capsa 6 kartu (3–8), 0 = 13 kartu.
   *  -> { ok, code, key } | { ok:false, error } */
  async assign(stake, user, six = 0) {
    const st = this.state;
    const key = randomKey();
    try {
      // 1) akun ini masih duduk di sebuah meja Ranked: kembali ke meja itu (berapa pun taruhan yang diminta)
      const cur = st.active[user.userId];
      if (cur) {
        const seat = await this.room(cur).seated(user.userId);
        if (seat && !seat.left) {
          const res = await this.room(cur).reserve({ ...user, key }); // menyegarkan saldo, kunci lama tetap dipakai
          if (res.ok) return { ok: true, code: cur, key: res.key, resumed: true };
        }
        delete st.active[user.userId];
      }
      // 2) meja terbuka untuk taruhan ini, kalau tidak ada/penuh buat meja baru
      let lastError = 'Gagal mencari meja';
      const slot = six ? `six${six}:${stake}` : stake; // antrean terpisah per jenis meja (13 kartu / 6 kartu per jumlah pemain)
      for (let i = 0; i < 3; i++) {
        let code = st.open[slot];
        if (!code) {
          code = randomCode();
          if (!(await this.room(code).initRanked(code, stake, six)).ok) continue;
          st.open[slot] = code;
        }
        const res = await this.room(code).reserve({ ...user, key });
        if (!res.ok || !res.joinable) delete st.open[slot];
        if (res.ok) {
          st.active[user.userId] = code;
          return { ok: true, code, key: res.key };
        }
        lastError = res.error || lastError;
        if (/Koin/.test(lastError)) break; // saldo kurang: meja baru pun akan menolak
      }
      return { ok: false, error: lastError };
    } finally {
      await this.ctx.storage.put('state', st);
    }
  }
}
