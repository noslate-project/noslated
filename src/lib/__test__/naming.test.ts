import assert from 'assert';
import isUUID from 'is-uuid';
import * as naming from '#self/lib/naming';

describe('test/lib/naming.test.js', () => {
  describe('codeBundleName', () => {
    it('should generate codeBundleName', () => {
      const funcName = 'a.b<c>d!e@f:g(h)i&j+k-l_m#n$o%p^q*r"s\'t,u.v/w;x`y}z{0[1]2|3=456789ABCDEFGHIJKLMNOPQRSTUVWXYZ囍';
      const url = 'https://xcoder.com';
      const signature = 'md5:abcdef12345678901234567890abcdef';

      const name = naming.codeBundleName(funcName, signature, url);
      assert.strictEqual(
        name,
        'ALICE-a.b_c_d_e_f_g_h_i_j_k-l_m_n_o_p_q_r_s_t_u.v_w_x_y_z_0_1_2_3_456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-b3bec26c-md5:abcdef12345678901234567890abcdef');
    });
  });

  describe('processName', () => {
    it('should generate processName', () => {
      const funcName = 'a.b<c>d!e@f:g(h)i&j+k-l_m#n$o%p^q*r"s\'t,u.v/w;x`y}z{0[1]2|3=456789ABCDEFGHIJKLMNOPQRSTUVWXYZ囍';

      const name = naming.processName(funcName);
      const a = name.substr(0, name.length - 7);
      const b = name.substr(name.length - 7);

      assert.strictEqual(
        a,
        'a.b_c_d_e_f_g_h_i_j_k-l_m_n_o_p_q_r_s_t_u.v_w_x_y_z_0_1_2_3_456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-');
      assert(/^[0-9a-z]{7}$/.test(b));
    });
  });

  describe('credential', () => {
    it('should generate credential', () => {
      const funcName = 'a.b<c>d!e@f:g(h)i&j+k-l_m#n$o%p^q*r"s\'t,u.v/w;x`y}z{0[1]2|3=456789ABCDEFGHIJKLMNOPQRSTUVWXYZ囍';
      const name = naming.credential(funcName);

      const a = name.substr(0, name.length - 36);
      const b = name.substr(name.length - 36);

      assert.strictEqual(
        a,
        'a.b<c>d!e@f:g(h)i&j+k-l_m#n$o%p^q*r"s\'t,u.v/w;x`y}z{0[1]2|3=456789ABCDEFGHIJKLMNOPQRSTUVWXYZ囍-');
      assert(isUUID.v4(b));
    });
  });
});
