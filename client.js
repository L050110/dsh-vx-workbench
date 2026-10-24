window.__ModuleLoader__.load({
  id: '@local/vx-workbench',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const C = {
      title: 'var(--dsw-alias-label-primary, currentColor)',
      dim: 'var(--dsw-alias-label-secondary, rgba(128,128,128,1))',
      line: 'rgba(127,127,127,0.25)',
      ok: '#22c55e',
      warn: '#f59e0b',
      bad: '#ef4444',
      accent: '#3b82f6',
    };

    function Icon(p) {
      const s = (p && p.size) || 16;
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: s, height: s, fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M2 13V7.2l4-2.1 3.2 1.7V9h4.6v4z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
        h('path', { d: 'M4.6 12.2V9.6', stroke: 'currentColor', strokeWidth: 1.1, opacity: 0.65 }),
        h('circle', { cx: 5.6, cy: 12.4, r: 1.05, stroke: 'currentColor', strokeWidth: 1.1 }),
        h('circle', { cx: 11.4, cy: 12.4, r: 1.05, stroke: 'currentColor', strokeWidth: 1.1 }),
        h('path', { d: 'M11.6 4.2l1.9 1.1M13.5 4.2l-1.9 1.1', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' })
      );
    }

    function Card(props) {
      return h(
        'div',
        {
          style:
            props.accent === true
              ? { border: '1px solid ' + C.accent, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }
              : { border: '1px solid ' + C.line, borderRadius: 10, padding: '14px 16px', marginBottom: 12 },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('div', { style: { fontSize: 12, letterSpacing: 0.4, color: C.dim, textTransform: 'uppercase' } }, props.title),
          h('div', { style: { flex: 1 } }),
          props.extra || null
        ),
        props.children
      );
    }

    function Row(props) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 } },
        h('span', { style: { width: 7, height: 7, borderRadius: 4, background: props.color || C.dim, flex: '0 0 auto' } }),
        h('span', { style: { color: C.title, minWidth: 96 } }, props.label),
        h('span', { style: { color: C.dim, wordBreak: 'break-all' } }, props.value)
      );
    }

    const btn = {
      fontSize: 12,
      padding: '6px 12px',
      borderRadius: 7,
      border: '1px solid ' + C.line,
      background: 'transparent',
      color: C.title,
      cursor: 'pointer',
    };
    const btnPrimary = { ...btn, border: '1px solid ' + C.accent, color: C.accent, fontWeight: 600 };
    const sel = {
      fontSize: 12,
      padding: '4px 6px',
      borderRadius: 6,
      border: '1px solid ' + C.line,
      background: 'transparent',
      color: C.title,
      maxWidth: 260,
    };

    function Panel() {
      const [state, setState] = useState(null);
      const [err, setErr] = useState('');
      const [note, setNote] = useState('');
      const [ask, setAsk] = useState('');
      const [toNew, setToNew] = useState(false);
      const [receipt, setReceipt] = useState(null);
      const [toast, setToast] = useState('');
      const [busy, setBusy] = useState('');
      const [showLogic, setShowLogic] = useState(false);
      const [pushArmed, setPushArmed] = useState(false);
      const [pickSkill, setPickSkill] = useState('');
      const [pickScope, setPickScope] = useState('vx');
      const askRef = useRef(null);

      const load = useCallback(() => {
        fetch('/vxwb')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((d) => {
            setState(d.status);
            setErr('');
          })
          .catch((e) => setErr(e.message || String(e)));
      }, []);

      useEffect(() => {
        load();
        const t = setInterval(load, 6000);
        return () => clearInterval(t);
      }, [load]);

      const post = (payload, label, after) => {
        setBusy(label || '');
        return fetch('/vxwb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
          .then(({ ok, j }) => {
            setToast((ok && j.ok ? '● ' : '○ ') + (j.note || j.path || j.error || '完成'));
            if (ok && j.ok && after) after();
            load();
            return ok && j.ok;
          })
          .catch((e) => {
            setToast('○ ' + (e.message || e));
            return false;
          })
          .finally(() => setBusy(''));
      };

      // One dropdown + one button: no JSON, no endpoint names for the operator.
      const applyClassify = () => {
        const name = pickSkill;
        if (!name) {
          setToast('○ 先在上面选一个技能');
          return;
        }
        if (pickScope === 'ignore') return post({ action: 'skill-ignore', names: [name] }, 'classify');
        if (pickScope === 'unignore') return post({ action: 'skill-unignore', names: [name] }, 'classify');
        post({ action: 'skill-scope', name, scope: pickScope }, 'classify');
      };

      const submitAsk = () => {
        const text = ask.trim();
        if (!text) {
          setToast('○ 先写一句需求');
          return;
        }
        post({ action: 'ask', text, newSession: toNew }, 'ask', () => setAsk(''));
      };

      // Two-step fan-out: first press previews the target count, second press sends.
      const pushSkills = () => {
        if (!pushArmed) {
          setBusy('skills-push');
          fetch('/vxwb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'skills-broadcast', dryRun: true, maxAgeHours: 168 }),
          })
            .then((r) => r.json())
            .then((j) => {
              if (!j.ok) {
                setToast('○ 预览失败：' + (j.error || ''));
                return;
              }
              setPushArmed(true);
              setToast(
                '○ 预览：近 7 天有动静的会话 ' + j.total + ' 个（可见共 ' + j.visible + ' 个）' +
                  (j.truncated ? '，单次上限会截断' : '') +
                  '。每个会话会跑一轮，再点一次确认。'
              );
            })
            .catch((e) => setToast('○ ' + (e.message || e)))
            .finally(() => setBusy(''));
          return;
        }
        post({ action: 'skills-broadcast', maxAgeHours: 168 }, 'skills-push', () => setPushArmed(false));
      };

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 } },
        h('h1', { style: { fontSize: 19, margin: 0, color: C.title } }, 'VX 破解 · 工厂工作台'),
        h('div', { style: { flex: 1 } }),
        h('button', { style: btn, onClick: load }, '刷新'),
        state ? h('span', { style: { fontSize: 11, color: C.dim } }, '更新于 ' + new Date(state.generatedAt).toLocaleTimeString()) : null
      );

      if (err && !state) {
        return h(
          'div',
          { style: { padding: 24, color: C.title } },
          header,
          h('div', { style: { marginTop: 16, color: C.bad, fontSize: 13 } }, '未就绪（' + err + '，需重载页面）')
        );
      }
      if (!state) return h('div', { style: { padding: 24, color: C.dim } }, '读取中…');

      const dll = state.dll || {};
      const sn = state.strongName || {};
      const patchOk = dll.state === 'patched';
      const fullOk = patchOk && sn.verificationRegistered && sn.allowBypassSet;
      const requests = state.requests || [];
      const sk = state.skills || null;
      const ov = (sk && sk.ov) || null;
      const ovBad = ov && ov.status !== 'live' && ov.status !== 'snapshot';
      const skWriteHint =
        '请用工作站协议写技能（先读 plugins/vx-workbench/skills/vx-skill-authoring/SKILL.md）：\n' +
        'POST http://127.0.0.1:63536/vxwb {"action":"skill-add","name":"vx-xxx","description":"Use when …（20-400字）","body":"# 标题\\n\\n## 症状\\n…\\n\\n## 做法\\n1. …\\n\\n## 验收\\n…"}\n' +
        '已有技能要改：{"action":"skill-update","name":"…","description":"…","body":"<完整正文>"}\n' +
        '不好用/有 bug：{"action":"skill-request-delete","name":"…","reason":"实测报错或已被谁取代"}\n' +
        '无关技能清出去：{"action":"skill-ignore","all":true}（只隐藏不删）';
      const skAdded = (sk && sk.added) || [];
      const skChanged = (sk && sk.changed) || [];
      const skRemoved = (sk && sk.removed) || [];

      const chip = (label, ok, extra) =>
        h(
          'div',
          { style: { flex: 1, minWidth: 150, border: '1px solid ' + C.line, borderRadius: 10, padding: '10px 12px' } },
          h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 6 } }, label),
          h('div', { style: { fontSize: 15, fontWeight: 600, color: ok ? C.ok : C.warn } }, ok ? '正常' : '未生效'),
          extra ? h('div', { style: { fontSize: 11, color: C.dim, marginTop: 4 } }, extra) : null
        );

      return h(
        'div',
        { style: { padding: '22px 26px', color: C.title, height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        header,
        h(
          'div',
          { style: { fontSize: 12, color: C.dim, marginBottom: 16 } },
          fullOk ? 'CAD 导入授权已打通：FBX / STEP / STL 可直接导入。' : 'CAD 导入授权未完全生效，见下方明细。'
        ),

        // ---- 需求入口（最显眼） ----
        h(
          Card,
          {
            title: '我要提需求',
            accent: true,
            extra: h('span', { style: { fontSize: 11, color: C.dim } }, 'Ctrl+Enter 提交'),
          },
          h('textarea', {
            ref: askRef,
            value: ask,
            rows: 3,
            onChange: (e) => setAsk(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitAsk();
              }
            },
            placeholder: '直接写你要什么，例如：把出厂那排车改成斜列、路面加车道标线；或者：为什么涂装车间没有机器人',
            style: {
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 13,
              lineHeight: 1.6,
              padding: '9px 11px',
              borderRadius: 8,
              border: '1px solid ' + C.line,
              background: 'transparent',
              color: C.title,
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
            },
          }),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' } },
            h(
              'button',
              { style: btnPrimary, disabled: busy === 'ask', onClick: submitAsk },
              busy === 'ask' ? '发送中…' : '提问并发送'
            ),
            h(
              'label',
              {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  padding: '5px 10px',
                  borderRadius: 7,
                  border: '1px solid ' + (toNew ? C.accent : C.line),
                  color: toNew ? C.accent : C.dim,
                  cursor: 'pointer',
                  userSelect: 'none',
                },
              },
              h('input', {
                type: 'checkbox',
                checked: toNew,
                onChange: (e) => setToNew(e.target.checked),
                style: { margin: 0, accentColor: C.accent },
              }),
              '发到新对话（省 token）'
            ),
            h(
              'span',
              { style: { fontSize: 11, color: C.dim, flex: 1, minWidth: 220 } },
              toNew
                ? '会新建对话：继承同一 preset（工具/技能照旧）+ 自动附上交接简报，当前对话不增加上下文。'
                : '默认发到当前对话；勾左边那一项可改为发到新对话（省 token，能力不减）。'
            )
          ),
          requests.length
            ? h(
                'div',
                { style: { marginTop: 12 } },
                requests
                  .slice()
                  .reverse()
                  .slice(0, 6)
                  .map((r, i) =>
                    h(
                      'div',
                      { key: i, style: { fontSize: 12, padding: '5px 0', borderTop: '1px solid ' + C.line, color: C.dim } },
                      h(
                        'span',
                        {
                          style: {
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            marginRight: 7,
                            background: r.status === 'sent' ? C.ok : r.status === 'failed' ? C.bad : C.warn,
                          },
                        }
                      ),
                      h('span', { style: { marginRight: 8 } }, (r.at || '').replace('T', ' ').slice(0, 19)),
                      r.target === 'new'
                        ? h(
                            'span',
                            {
                              style: {
                                fontSize: 10,
                                marginRight: 8,
                                padding: '1px 5px',
                                borderRadius: 4,
                                border: '1px solid ' + C.accent,
                                color: C.accent,
                              },
                            },
                            '新对话'
                          )
                        : null,
                      h('span', { style: { color: C.title } }, (r.text || '').slice(0, 180)),
                      r.sessionId
                        ? h(
                            'button',
                            {
                              style: { ...btn, padding: '2px 8px', marginLeft: 8, fontSize: 11 },
                              onClick: () => {
                                setReceipt({ sessionId: r.sessionId, text: '读取中…' });
                                fetch('/vxwb', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'tail', sessionId: r.sessionId }),
                                })
                                  .then((x) => x.json())
                                  .then((j) =>
                                    setReceipt({
                                      sessionId: r.sessionId,
                                      text: j.ok ? j.last || '（那边还没有回答）' : '读取失败：' + (j.error || ''),
                                    })
                                  )
                                  .catch((e) => setReceipt({ sessionId: r.sessionId, text: '读取失败：' + e.message }));
                              },
                            },
                            '看回执'
                          )
                        : null
                    )
                  )
              )
            : null,
          receipt
            ? h(
                'div',
                {
                  style: {
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid ' + C.line,
                    fontSize: 12,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    color: C.title,
                    maxHeight: 220,
                    overflow: 'auto',
                  },
                },
                h('div', { style: { color: C.dim, marginBottom: 6 } }, '回执 · ' + receipt.sessionId),
                receipt.text
              )
            : null
        ),

        h(
          'div',
          { style: { display: 'flex', gap: 12, marginBottom: 14 } },
          chip('HOOPS 补丁', patchOk, dll.state === 'patched' ? '偏移 173095 = ' + dll.byte : dll.state === 'original' ? '仍为原版 0x75' : 'DLL 未找到'),
          chip('强名称免验证', sn.verificationRegistered, sn.allowBypassSet ? 'AllowStrongNameBypass 已设' : 'AllowStrongNameBypass 未设'),
          chip('原版备份', (state.backup || {}).present, '可用于一键还原'),
          chip('Visual X-Space', (state.process || {}).running, (state.process || {}).running ? '进程运行中' : '未运行')
        ),

        // ---- 破解 / 工作逻辑 ----
        h(
          Card,
          {
            title: '破解逻辑 · 工作逻辑',
            extra: h(
              'button',
              { style: { ...btn, padding: '3px 9px' }, onClick: () => setShowLogic(!showLogic) },
              showLogic ? '收起' : '展开'
            ),
          },
          h(
            'div',
            { style: { fontSize: 12, color: C.dim, marginBottom: showLogic ? 10 : 0 } },
            '两道门（HOOPS 授权判定 · CLR 强名称验证）、模型尺寸与朝向的根因、我在这套流程里的工作方式与待办。' +
              '（文档：plugins/vx-workbench/docs/logic.md）'
          ),
          showLogic
            ? h(
                'pre',
                {
                  style: {
                    margin: 0,
                    maxHeight: 460,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.65,
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: '1px solid ' + C.line,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: C.title,
                    fontFamily: 'ui-monospace, Consolas, monospace',
                  },
                },
                state.logic || '（文档缺失）'
              )
            : null
        ),

        h(
          Card,
          { title: '明细' },
          h(Row, { label: 'DLL', value: dll.path || '（未知）', color: patchOk ? C.ok : C.warn }),
          h(Row, { label: 'SHA256', value: (dll.sha256 || '（未取到）').slice(0, 32) + '…' }),
          h(Row, { label: '修改时间', value: dll.mtime ? new Date(dll.mtime).toLocaleString() : '（未知）' }),
          h(Row, { label: '程序集', value: sn.assembly || '（未知）' }),
          h(Row, { label: '数据目录', value: state.dataDir || '（未知）' })
        ),

        h(
          Card,
          { title: '一键操作' },
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            h('button', { style: btn, disabled: busy === 'install', onClick: () => post({ action: 'install' }, 'install') }, busy === 'install' ? '启动中…' : '安装 / 修复补丁'),
            h('button', { style: btn, onClick: () => post({ action: 'restore' }, 'restore') }, '还原为原版'),
            h('button', { style: btn, onClick: () => post({ action: 'open-install' }) }, '打开安装目录'),
            h('button', { style: btn, onClick: () => post({ action: 'open-crack' }) }, '打开破解包'),
            h('button', { style: btn, onClick: () => post({ action: 'open-delivery' }) }, '打开交付目录')
          ),
          h('div', { style: { fontSize: 11, color: C.dim, marginTop: 10 } }, '安装/还原会弹出 UAC，点“是”后脚本自动备份、关掉 VC、写入并校验。')
        ),

        h(
          Card,
          { title: '工厂资产（' + (state.layouts || []).length + '）' },
          (state.layouts || []).length === 0
            ? h('div', { style: { fontSize: 13, color: C.dim } }, '交付目录里还没有 .vcmx')
            : (state.layouts || []).map((f) =>
                h(
                  'div',
                  {
                    key: f.path,
                    style: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid ' + C.line, fontSize: 13 },
                  },
                  h('span', { style: { flex: 1, color: C.title, wordBreak: 'break-all' } }, f.name),
                  h('span', { style: { color: C.dim, fontSize: 12 } }, f.sizeMB + ' MB'),
                  h('span', { style: { color: C.dim, fontSize: 11, width: 130 } }, new Date(f.mtime).toLocaleString()),
                  h('button', { style: { ...btn, padding: '4px 9px' }, onClick: () => post({ action: 'open-file', name: f.name }) }, '定位')
                )
              )
        ),

        // ---- 技能台账 · 自动迭代 ----
        h(
          Card,
          {
            title: '技能台账 · 自动迭代',
            extra: sk
              ? h('span', { style: { fontSize: 11, color: C.dim } }, '扫描于 ' + new Date(sk.scannedAt).toLocaleTimeString() + ' · 每 5 分钟自动')
              : null,
          },
          !sk
            ? h(
                'div',
                { style: { fontSize: 13, color: C.dim } },
                '台账还没生成：插件重载后约 2 秒自动建一次，或点下面「立即扫描」。'
              )
            : h(
                'div',
                null,
                h(
                  'div',
                  { style: { display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap', alignItems: 'baseline' } },
                  h('span', { style: { fontSize: 15, fontWeight: 600, color: C.accent } }, '工作站技能 ' + (sk.vxCount || 0)),
                  h('span', { style: { fontSize: 12, color: C.dim } }, '其它全局 ' + (sk.otherCount || 0) + ' 个（仅登记）'),
                  h('span', { style: { fontSize: 12, color: C.dim } }, 'digest ' + String(sk.digest || '').slice(0, 10)),
                  h('span', { style: { fontSize: 12, color: C.dim } }, '监控 ' + sk.watched + ' 个根目录'),
                  sk.autoNotify ? h('span', { style: { fontSize: 11, color: C.accent } }, '自动通知：开') : null
                ),
                h(Row, {
                  label: '新增',
                  value: skAdded.length ? skAdded.join('、') : sk.initial ? '首次扫描建立基线' : '无',
                  color: skAdded.length ? C.ok : C.dim,
                }),
                h(Row, {
                  label: '变更',
                  value: skChanged.length ? skChanged.join('、') : '无',
                  color: skChanged.length ? C.warn : C.dim,
                }),
                h(Row, {
                  label: '移除',
                  value: skRemoved.length ? skRemoved.join('、') : '无',
                  color: skRemoved.length ? C.bad : C.dim,
                }),
                h(Row, { label: '台账文件', value: sk.ledgerPath || '（路径未知）' }),
                h(Row, {
                  label: 'OpenViking',
                  value: ov
                    ? ov.status === 'live'
                      ? '直连 · ' + ov.count + ' 个技能 · ' + (ov.baseUrl || '')
                      : ov.status === 'snapshot'
                        ? '快照 · ' + ov.count + ' 个技能 · ' + (ov.capturedAt || '')
                        : ov.status +
                          '（' +
                          (ov.error || '未连接') +
                          '）' +
                          (ov.count ? ' · 冷备 ' + ov.count + ' 个' : '')
                    : '（未知）',
                  color: ov && (ov.status === 'live' || ov.status === 'snapshot') ? C.ok : C.dim,
                }),
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' } },
                  h(
                    'button',
                    { style: btn, disabled: busy === 'skills-scan', onClick: () => post({ action: 'skills-scan' }, 'skills-scan') },
                    busy === 'skills-scan' ? '扫描中…' : '立即扫描'
                  ),
                  h('button', { style: btn, onClick: () => post({ action: 'open-doc', name: 'skills.md' }) }, '打开台账'),
                  h(
                    'button',
                    { style: btn, disabled: busy === 'ov-check', onClick: () => post({ action: 'ov-check' }, 'ov-check') },
                    busy === 'ov-check' ? '检测中…' : '检测 OpenViking'
                  ),
                  ov && ov.instruction
                    ? h(
                        'button',
                        {
                          style: btn,
                          onClick: () => {
                            try {
                              navigator.clipboard.writeText(ov.instruction).then(
                                () => setToast('● 抓取指令已复制，粘到任一对话里跑一次即可'),
                                () => setToast('○ 复制被浏览器拦了，手动抄下面框里的字')
                              );
                            } catch (e) {
                              setToast('○ 复制不可用，手动抄下面框里的字');
                            }
                          },
                        },
                        '复制抓取指令'
                      )
                    : null,
                  h(
                    'button',
                    { style: pushArmed ? btnPrimary : btn, disabled: busy === 'skills-push', onClick: pushSkills },
                    busy === 'skills-push' ? '发送中…' : pushArmed ? '确认：推送到所有会话' : '推送到所有会话'
                  ),
                  h(
                    'label',
                    {
                      style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        padding: '5px 10px',
                        borderRadius: 7,
                        border: '1px solid ' + (sk.autoNotify ? C.accent : C.line),
                        color: sk.autoNotify ? C.accent : C.dim,
                        cursor: 'pointer',
                        userSelect: 'none',
                      },
                    },
                    h('input', {
                      type: 'checkbox',
                      checked: sk.autoNotify === true,
                      onChange: (e) => post({ action: 'skills-settings', autoNotify: e.target.checked }, 'skills-settings'),
                      style: { margin: 0, accentColor: C.accent },
                    }),
                    '变化时自动通知会话'
                  )
                ),
                h(
                  'div',
                  { style: { fontSize: 11, color: C.dim, marginTop: 9, lineHeight: 1.7 } },
                  '「推送」= 把一条紧凑技能通知，用排队消息塞进每个已存在会话（不含 subagent / 空白会话）。忙的会话在当前回合结束后执行，闲的会话会被唤醒跑一轮——会消耗 token，所以默认不自动。'
                ),
                ov && ovBad && ov.instruction
                  ? h(
                      'pre',
                      {
                        style: {
                          fontSize: 11,
                          lineHeight: 1.65,
                          marginTop: 8,
                          padding: '9px 11px',
                          borderRadius: 8,
                          border: '1px solid ' + C.line,
                          background: 'transparent',
                          color: C.dim,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'ui-monospace, Consolas, monospace',
                        },
                      },
                      ov.instruction
                    )
                  : null,
                (sk.pending || []).length
                  ? h(
                      'div',
                      { style: { marginTop: 10, borderTop: '1px solid ' + C.line, paddingTop: 10 } },
                      h('div', { style: { fontSize: 12, color: C.warn, marginBottom: 6 } }, '待批准的删除申请 ' + (sk.pending || []).length + ' 条'),
                      (sk.pending || []).map((r) =>
                        h(
                          'div',
                          { key: r.id, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '3px 0' } },
                          h('span', { style: { flex: 1, color: C.title, wordBreak: 'break-all' } }, '`' + r.name + '` — ' + String(r.reason || '').slice(0, 90)),
                          h('button', { style: { ...btn, padding: '3px 9px' }, onClick: () => post({ action: 'skill-resolve', id: r.id, decision: 'accept' }, 'skill-resolve') }, '批准删除'),
                          h('button', { style: { ...btn, padding: '3px 9px' }, onClick: () => post({ action: 'skill-resolve', id: r.id, decision: 'reject' }, 'skill-resolve') }, '驳回')
                        )
                      )
                    )
                  : null,
                h(
                  'div',
                  { style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 11, color: C.dim } }, '无关技能：已忽略 ' + (sk.ignoredCount || 0) + ' 个'),
                  h('button', { style: { ...btn, padding: '3px 9px' }, onClick: () => post({ action: 'skill-ignore', all: true }, 'skill-ignore') }, '忽略全部无关'),
                  h('button', { style: { ...btn, padding: '3px 9px' }, onClick: () => post({ action: 'skill-unignore', all: true }, 'skill-unignore') }, '恢复全部'),
                  h(
                    'button',
                    {
                      style: { ...btn, padding: '3px 9px' },
                      onClick: () => {
                        try {
                          navigator.clipboard.writeText(skWriteHint).then(
                            () => setToast('● 「写技能」协议已复制，粘到任一对话即可让它自己写'),
                            () => setToast('○ 复制被拦，手动看台账末尾的用法')
                          );
                        } catch (e) {
                          setToast('○ 复制不可用');
                        }
                      },
                    },
                    '复制「写技能」指令'
                  )
                ),
                h(
                  'div',
                  { style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 11, color: C.dim } }, '归类：'),
                  h(
                    'select',
                    { value: pickSkill, onChange: (e) => setPickSkill(e.target.value), style: sel },
                    h('option', { value: '' }, '— 选技能 —'),
                    (sk.list || [])
                      .filter((x) => !x.ignored)
                      .map((x) => h('option', { key: x.name, value: x.name }, (x.scope === 'vx' ? '[工作站] ' : '[其它] ') + x.name)),
                    (sk.list || [])
                      .filter((x) => x.ignored)
                      .map((x) => h('option', { key: 'ign-' + x.name, value: x.name }, '[已忽略] ' + x.name))
                  ),
                  h(
                    'select',
                    { value: pickScope, onChange: (e) => setPickScope(e.target.value), style: sel },
                    h('option', { value: 'vx' }, '归到工作站'),
                    h('option', { value: 'other' }, '归到其它'),
                    h('option', { value: 'ignore' }, '忽略（隐藏，不删文件）'),
                    h('option', { value: 'unignore' }, '取消忽略'),
                    h('option', { value: 'auto' }, '恢复自动判定')
                  ),
                  h(
                    'button',
                    { style: { ...btn, padding: '4px 12px' }, disabled: busy === 'classify', onClick: applyClassify },
                    busy === 'classify' ? '处理中…' : '归类'
                  )
                ),
                (sk.list || []).length
                  ? h(
                      'div',
                      { style: { fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.75, wordBreak: 'break-all' } },
                      h(
                        'span',
                        { style: { color: C.title } },
                        (sk.list || []).filter((x) => x.scope === 'vx').map((x) => x.name).join(' · ') || '（没有工作站技能）'
                      ),
                      h('span', null, ' ｜ 其它全局 ' + (sk.otherCount || 0) + ' 个见台账')
                    )
                  : null
              )
        ),

        h(
          Card,
          { title: '工作记录（写入文件，agent 可读）' },
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginBottom: 10 } },
            h('input', {
              value: note,
              onChange: (e) => setNote(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && note.trim()) {
                  post({ action: 'log', text: note }, 'log', () => setNote(''));
                }
              },
              placeholder: '只记一条备注（不会发给 agent）：改了什么 / 结论',
              style: {
                flex: 1,
                fontSize: 13,
                padding: '7px 10px',
                borderRadius: 7,
                border: '1px solid ' + C.line,
                background: 'transparent',
                color: C.title,
                outline: 'none',
              },
            }),
            h(
              'button',
              {
                style: btn,
                onClick: () => {
                  if (!note.trim()) return;
                  post({ action: 'log', text: note }, 'log', () => setNote(''));
                },
              },
              '追加'
            )
          ),
          (state.log || []).length === 0
            ? h('div', { style: { fontSize: 12, color: C.dim } }, '还没有记录')
            : (state.log || [])
                .slice()
                .reverse()
                .slice(0, 12)
                .map((l, i) =>
                  h(
                    'div',
                    { key: i, style: { fontSize: 12, color: C.dim, padding: '4px 0', borderTop: '1px solid ' + C.line } },
                    h('span', { style: { marginRight: 8 } }, (l.at || '').replace('T', ' ').slice(0, 19)),
                    h('span', { style: { color: C.title } }, (l.kind ? '[' + l.kind + '] ' : '') + (l.text || ''))
                  )
                )
        ),

        toast ? h('div', { style: { position: 'sticky', bottom: 0, fontSize: 12, color: C.dim, paddingTop: 8 } }, toast) : null
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'vx-workbench' }, Panel));
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'vx-workbench', order: 60, label: 'VX 工作台 v0.4.0' }, Icon)
        );
      },
    };
  },
});
