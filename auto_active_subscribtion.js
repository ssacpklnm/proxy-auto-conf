/**
 * FlowerCloud (WHMCS) 自动登录并打开订阅开关 - Sub-Store 脚本操作 (Script Operator)
 *
 * 参考模板：https://raw.githubusercontent.com/xream/scripts/main/surge/modules/sub-store-scripts/sub-info/autoLogin.js
 *
 * ==================== Sub-Store 配置说明 ====================
 * 在 Sub-Store ->「单条订阅」->「脚本操作 (Script Operator)」中添加本脚本。
 *
 * 方式 A（推荐，最省事）：【仅登录开启开关 + 由本脚本拉取现成订阅链接】
 *   1. 单条订阅「来源」选择「本地 (Local)」，内容留空（避免 Sub-Store 在脚本运行前请求未开启的订阅而报错）。
 *   2. 在下方脚本参数 ($arguments) 或脚本默认值中配置 `subUrl`（你的现成订阅链接）。
 *   3. 脚本会自动完成：[1] 获取 CSRF Token -> [2] 登录 WHMCS -> [3] 开启订阅开关 (ActivateSublink) -> [4] 拉取 `subUrl` 节点并写入流量信息。
 *
 * 方式 B：【仅执行登录与开启订阅开关，不拉取订阅（纯前置触发器）】
 *   1. 如果你已经在其他地方配置了订阅链接，或者只需要触发开关，不传 `subUrl`（或将 `fetchSub` 设为 `false`）。
 *   2. 脚本执行完第 [3] 步开启订阅开关后，直接原样返回当前 `proxies` 列表。
 *
 * ==================== 支持的脚本参数 ($arguments) ====================
 * 可在 Sub-Store 脚本参数面板中添加，或直接在脚本链接后拼接 `#user=xxx&password=xxx`：
 * - api          : 机场面板地址（默认: https://api-flowercloud.com）
 * - user         : 登录邮箱（已预填抓包账号，支持外部覆盖）
 * - password     : 登录密码（已预填抓包密码，支持外部覆盖）
 * - serviceId    : 套餐产品 ID（默认: 318178）
 * - ua           : 登录与操作面板时的浏览器 UA（需与抓包获取 cf_clearance 时一致）
 * - cf_clearance : 可选，若触发 Cloudflare 403 拦截，填入抓包中的 cf_clearance Cookie 值
 * - subUrl       : 可选，你现成的机场订阅链接（填写后将在开启开关后自动拉取节点与流量信息）
 * - subUA        : 可选，拉取订阅链接时的 UA（默认: clash.meta）
 * - timeout      : 可选，请求超时时间（默认: 15000 毫秒）
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore;
  const SUBS_KEY = 'subs';
  const args = typeof $arguments !== 'undefined' && $arguments ? $arguments : {};

  // 1. 读取参数（支持 $arguments 传参，未传时使用抓包提取的默认值）
  const api = String(args.api || 'https://api-flowercloud.com').replace(/\/+$/, '');
  const user = args.user || args.username || 'zyx1069958401@gmail.com';
  const password = args.password || 'as159753';
  const serviceId = String(args.serviceId || args.id || '318178');
  const ua =
    args.ua ||
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
  const cfClearance = args.cf_clearance || args.cfClearance || '';
  const subUrl = args.subUrl || args.sub_url || '';
  const subUA = args.subUA || args.sub_ua || 'clash.meta';
  const timeout = Number(args.timeout) || 15000;

  // 2. 简易 Cookie 管理器（跨 Step 1 -> Step 2 -> Step 3 维护 WHMCS 会话 Cookie）
  const cookieMap = {};
  if (cfClearance) {
    cookieMap['cf_clearance'] = cfClearance;
  }

  function updateCookies(headers) {
    if (!headers) return;
    const rawSetCookie =
      headers['set-cookie'] || headers['Set-Cookie'] || headers['SET-COOKIE'];
    if (!rawSetCookie) return;

    // 兼容数组或换行/逗号分隔的多条 Set-Cookie（排除 expires=Thu, 01-Jan... 中的逗号）
    const cookieList = Array.isArray(rawSetCookie)
      ? rawSetCookie
      : String(rawSetCookie).split(/,(?=\s*[A-Za-z0-9_\-%]+=)/);

    for (const item of cookieList) {
      const firstPart = String(item).split(';')[0].trim();
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx > 0) {
        const k = firstPart.slice(0, eqIdx).trim();
        const v = firstPart.slice(eqIdx + 1).trim();
        if (v === 'deleted' || v === '') {
          delete cookieMap[k];
        } else {
          cookieMap[k] = v;
        }
      }
    }
  }

  function getCookieHeader() {
    return Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  const baseHeaders = {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh-Hans;q=0.9',
  };

  try {
    // ==================== Step 1: 访问登录页获取 CSRF Token 与初始 Cookie ====================
    const clientareaUrl = `${api}/clientarea.php`;
    $.info(`[FlowerCloud] [1/3] 请求登录页获取 CSRF Token: ${clientareaUrl}`);

    const pageRes = await $.http.get({
      url: clientareaUrl,
      headers: {
        ...baseHeaders,
        ...(getCookieHeader() ? { cookie: getCookieHeader() } : {}),
      },
      timeout,
    });

    const pageStatus = Number(pageRes.statusCode || pageRes.status || 0);
    updateCookies(pageRes.headers);

    if (pageStatus === 403) {
      $.error(
        `[FlowerCloud] 触发 Cloudflare 403 拦截！请在脚本参数中配置有效的 cf_clearance 与匹配的 ua`
      );
      return proxies;
    }

    const pageHtml = String(pageRes.body || '');
    const tokenMatch =
      pageHtml.match(/name=["']token["']\s+value=["']([a-f0-9]{40})["']/i) ||
      pageHtml.match(/csrfToken\s*=\s*["']([a-f0-9]{40})["']/i);

    if (!tokenMatch || !tokenMatch[1]) {
      $.error(
        `[FlowerCloud] 未能从 clientarea.php 提取到 40 位 CSRF Token（状态码: ${pageStatus}），跳过`
      );
      return proxies;
    }

    const csrfToken = tokenMatch[1];
    $.info(`[FlowerCloud] 成功提取 CSRF Token: ${csrfToken}`);

    // ==================== Step 2: 提交登录表单 (POST /dologin.php) ====================
    // 若刚才 GET /clientarea.php 已经处于登录态（页面包含 logout.php），可跳过重复 POST
    const alreadyLoggedIn =
      pageHtml.includes('logout.php') && !pageHtml.includes('dologin.php');

    if (alreadyLoggedIn) {
      $.info(`[FlowerCloud] [2/3] 检测到当前 Cookie 已处于登录状态，跳过重复登录`);
    } else {
      const loginUrl = `${api}/dologin.php`;
      $.info(`[FlowerCloud] [2/3] 提交账号密码至登录接口: ${loginUrl}`);

      const formBody = [
        `token=${encodeURIComponent(csrfToken)}`,
        `username=${encodeURIComponent(user)}`,
        `password=${encodeURIComponent(password)}`,
      ].join('&');

      // 关键：禁止自动重定向 (followRedirect: false, auto-redirect: false)，
      // 以便捕获 302 Found 响应头下发的新 WHMCSy551iLvnhYt7 会话 Cookie
      const loginRes = await $.http.post({
        url: loginUrl,
        headers: {
          ...baseHeaders,
          'content-type': 'application/x-www-form-urlencoded',
          origin: api,
          referer: clientareaUrl,
          cookie: getCookieHeader(),
        },
        body: formBody,
        followRedirect: false,
        'auto-redirect': false,
        redirection: false,
        timeout,
      });

      const loginStatus = Number(loginRes.statusCode || loginRes.status || 0);
      updateCookies(loginRes.headers);

      const locationHeader =
        loginRes.headers?.location || loginRes.headers?.Location || '';
      $.info(
        `[FlowerCloud] 登录响应状态码: ${loginStatus}, 跳转 Location: ${locationHeader}`
      );

      if (String(locationHeader).includes('incorrect=true')) {
        $.error(`[FlowerCloud] 登录失败：邮箱或密码错误 (incorrect=true)`);
        return proxies;
      }
    }

    // ==================== Step 3: 开启订阅开关 (ActivateSublink) ====================
    const activateUrl = `${api}/clientarea.php?action=productdetails&id=${encodeURIComponent(
      serviceId
    )}&V2raySocksAction=ActivateSublink&Serviceid=${encodeURIComponent(
      serviceId
    )}`;
    $.info(`[FlowerCloud] [3/3] 正在开启订阅开关: ${activateUrl}`);

    const activateRes = await $.http.get({
      url: activateUrl,
      headers: {
        ...baseHeaders,
        referer: `${api}/clientarea.php?action=productdetails&id=${encodeURIComponent(
          serviceId
        )}`,
        cookie: getCookieHeader(),
      },
      timeout,
    });

    const activateStatus = Number(
      activateRes.statusCode || activateRes.status || 0
    );
    const activateText = String(activateRes.body || '').trim();
    $.info(
      `[FlowerCloud] 开启订阅开关响应 (状态码 ${activateStatus}): ${activateText.slice(
        0,
        100
      )}`
    );

    if (activateText === 'success') {
      $.info(`✅ [FlowerCloud] 订阅更新开关开启成功！`);
    } else {
      $.error(
        `⚠️ [FlowerCloud] 开启订阅开关返回非预期内容: ${activateText.slice(0, 120)}`
      );
    }

    // ==================== (可选) Step 4: 若传入了现成 subUrl，拉取节点并写入流量信息 ====================
    if (!subUrl) {
      return proxies;
    }

    $.info(`[FlowerCloud] 正在使用现成订阅链接拉取节点: ${subUrl}`);
    const { statusCode, body, headers } = await $.http.get({
      url: subUrl,
      headers: {
        'user-agent': subUA,
      },
      timeout,
    });

    const subStatus = Number(statusCode || 0);
    if (subStatus < 200 || subStatus >= 400) {
      $.error(`[FlowerCloud] 请求订阅地址失败，状态码 ${subStatus}，跳过`);
      return proxies;
    }

    let parsed;
    try {
      parsed = ProxyUtils.parse(body);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        $.error(`[FlowerCloud] 订阅不包含有效节点，跳过`);
        return proxies;
      }
      $.info(`[FlowerCloud] 成功解析节点数: ${parsed.length}`);
    } catch (e) {
      $.error(`[FlowerCloud] 解析订阅节点失败: ${e.message ?? e}，跳过`);
      return proxies;
    }

    const subscriptionUserinfo =
      headers?.['subscription-userinfo'] || headers?.['Subscription-Userinfo'];
    if (subscriptionUserinfo) {
      $.info(`[FlowerCloud] 订阅流量信息: ${subscriptionUserinfo}`);
    }

    const source = context?.source;
    if (source && $.read && $.write) {
      const allSubs = $.read(SUBS_KEY) || [];
      for (const name in source) {
        const sub = source[name];
        if (sub?.name) {
          for (let index = 0; index < allSubs.length; index++) {
            if (sub.name === allSubs[index].name) {
              $.info(`[FlowerCloud] 写入订阅流量信息与节点内容到 Sub-Store 缓存`);
              if (subscriptionUserinfo) {
                allSubs[index].subUserinfo = subscriptionUserinfo;
              }
              allSubs[index].content = body;
              break;
            }
          }
          break;
        }
      }
      $.write(allSubs, SUBS_KEY);
    }

    return parsed;
  } catch (err) {
    $.error(`[FlowerCloud] 脚本执行异常: ${err.message ?? err}`);
    return proxies;
  }
}
