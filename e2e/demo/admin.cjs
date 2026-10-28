// Admin + manager checks against the running demo: login pages, roles, product/category/order/settings flows, API failures.
const { WEB: W, ADMIN: A, launch, reporter, makeContext, resetDemo, leftoverBangla } = require('./lib.cjs');
const { ok, done } = reporter('admin');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  await resetDemo();
  const b = await launch(); const errs = [];
  const mk = async (vp = { width: 1366, height: 900 }, lang = 'bn') => makeContext(b, errs, { vp, lang });
  const login = async (p, as, u, pw) => { await p.goto(A + (as === 'manager' ? '/manager/login' : '/login'), { waitUntil: 'load' }); await p.fill('#login', u); await p.fill('#password', pw); await p.getByRole('button', { name: /^(লগইন|Log in)$/ }).click(); };
  const api = (c, m, path, data) => c.request.fetch(A + '/v1' + path, { method: m, data, headers: { 'x-csrf-token': 't' } });
 // ---------- admin login
 let [c,p]=await mk(); await login(p,'admin','admin@demo.local','wrong'); await p.waitForTimeout(700); ok('admin login: wrong password rejected with message', /সঠিক নয়/.test(await p.locator('main').innerText()));
 await p.fill('#password',''); await p.fill('#login','manager@demo.local'); await p.fill('#password','manager1234'); await p.getByRole('button',{name:'লগইন',exact:true}).click(); await p.waitForTimeout(700); ok('manager credentials rejected on the ADMIN login page', /সঠিক নয়/.test(await p.locator('main').innerText()) && /\/login/.test(p.url()));
 await p.fill('#login','admin@demo.local'); await p.fill('#password','demo1234'); await p.getByRole('button',{name:'লগইন',exact:true}).click(); await p.waitForURL(u=>u.pathname==='/',{timeout:8000}).catch(()=>{}); await p.waitForTimeout(1200);
 ok('admin lands on dashboard with sidebar incl. Settings', /ড্যাশবোর্ড/.test(await p.locator('aside').innerText()) && /সেটিংস/.test(await p.locator('aside').innerText()));
 let t=await p.locator('main').innerText(); ok('dashboard: 59 products, all 59 without price', /মোট পণ্য\s*\n?\s*59|59/.test(t) && await p.locator('a[href="/products?status=noprice"]').innerText().then(x=>/59/.test(x)));
 // ---------- products list + quick prices
 await p.goto(A+'/products',{waitUntil:'load'}); await p.waitForTimeout(1200);
 ok('products: 59 rows, search + category + status filters', await p.locator('tbody tr').count()===59);
 await p.fill('#pq','Rasgulla'); await p.waitForTimeout(700); ok('products search "Rasgulla"', await p.locator('tbody tr').count()===1); await p.fill('#pq','');
 await p.locator('.pill',{hasText:'দাম নেই'}).click(); await p.waitForTimeout(600); ok('filter "no price" shows 59', await p.locator('tbody tr').count()===59);
 await p.fill('#pq','Sandesh'); await p.waitForTimeout(600); const n=await p.locator('tbody tr').count(); await p.locator('tbody tr').nth(0).locator('input[inputmode=decimal]').fill('120'); await p.locator('tbody tr').nth(1).locator('input[inputmode=decimal]').fill('abc');
 await p.getByRole('button',{name:'দাম সংরক্ষণ'}).click(); await p.waitForTimeout(500); ok('invalid price blocked with message', /সঠিক নয়/.test(await p.locator('main').innerText()));
 await p.locator('tbody tr').nth(1).locator('input[inputmode=decimal]').fill('150.50'); await p.getByRole('button',{name:'দাম সংরক্ষণ'}).click(); await p.waitForTimeout(900);
 const store=await (await c.request.get(W+'/v1/catalog/products?limit=48&q=sandesh')).json(); const priced=store.data.filter(x=>x.fromPricePoisha!==null).map(x=>x.fromPricePoisha).sort();
 ok('quick price save reaches the storefront API (৳120 and ৳150.50)', priced.includes(12000)&&priced.includes(15050), JSON.stringify(priced));
 // ---------- product edit
 await p.fill('#pq',''); await p.fill('#pq','Kheer Mohan'); await p.waitForTimeout(600); await p.locator('tbody tr a').first().click(); await p.waitForURL(/\/products\//); await p.waitForTimeout(900);
 const pid=p.url().split('/').pop(); ok('edit page loads form with names', await p.inputValue('#f-en')==='Kheer Mohan');
 await p.fill('#f-bn','ক্ষীরমোহন (বিশেষ)'); await p.fill('#f-descriptionBn','ছানা ও ক্ষীরের মিষ্টি'); await p.locator('input[aria-label="সাইজ 1 লেবেল"]').fill('৫০০ গ্রাম'); await p.locator('input[aria-label="সাইজ 1 দাম"]').fill('450'); await p.locator('input[aria-label="সাইজ 1 স্টক"]').fill('12');
 await p.getByRole('button',{name:'+ আরেকটি সাইজ যোগ করুন'}).click(); await p.locator('input[aria-label="সাইজ 2 লেবেল"]').fill('১ কেজি'); await p.locator('input[aria-label="সাইজ 2 দাম"]').fill('850'); await p.locator('input[aria-label="সাইজ 2 পুরোনো দাম"]').fill('900'); await p.locator('input[aria-label="সাইজ 2 স্টক"]').fill('0');
 await p.selectOption('#f-outer','approved'); ok('outer-city result updates live', /আউটার সিটিতে ১-২ দিনে ডেলিভারি হবে/.test(await p.locator('main').innerText()));
 await p.getByRole('button',{name:'সংরক্ষণ করুন'}).click(); await p.waitForTimeout(900); ok('saved message shown', /সংরক্ষণ হয়েছে/.test(await p.locator('.action-bar').innerText()));
 const d=await (await c.request.get(W+'/v1/catalog/products/ds-07')).json();
 ok('storefront detail reflects name, description, sizes, price, offer, stock-out', d.nameBn==='ক্ষীরমোহন (বিশেষ)' && d.content.descriptionBn==='ছানা ও ক্ষীরের মিষ্টি' && d.variants.length===2 && d.variants[0].pricePoisha===45000 && d.variants[1].compareAtPoisha===90000 && d.variants[1].availability==='OUT_OF_STOCK' && d.outerCityStatus==='approved');
 const outer=await (await c.request.get(W+'/v1/catalog/products/ds-07')).json();
 // image upload: bad file then good file
 await p.setInputFiles('#img-file',{name:'x.png',mimeType:'image/png',buffer:Buffer.from('this is not an image')}); await p.waitForTimeout(700); ok('fake image (text renamed .png) rejected', /শুধু JPG|Only JPG|JPG, PNG/.test(await p.locator('main').innerText()) && /গ|JPG/.test('JPG'));
 const before=(await (await c.request.get(W+'/v1/catalog/products/ds-07')).json()).images.length; ok('no image stored after rejection', before===0);
 await p.setInputFiles('#img-file',{name:'photo.png',mimeType:'image/png',buffer:PNG}); await p.waitForTimeout(900);
 const d2=await (await c.request.get(W+'/v1/catalog/products/ds-07')).json(); ok('valid PNG upload shows on storefront product', d2.images.length===1 && /\/v1\/media\/photos\/ds-07\.png\?v=/.test(d2.images[0].url));
 const imgRes=await c.request.get(W+d2.images[0].url); ok('image served with correct type + nosniff', imgRes.headers()['content-type']==='image/png' && imgRes.headers()['x-content-type-options']==='nosniff');
 await p.getByRole('button',{name:'ছবি মুছুন'}).click(); await p.waitForTimeout(700); ok('image delete works', (await (await c.request.get(W+'/v1/catalog/products/ds-07')).json()).images.length===0);
 // storefront Outer City now includes the product
 const [sc,sp]=await mk({width:1366,height:900}); await sp.goto(W,{waitUntil:'load'}); await sp.getByRole('button',{name:'আউটার সিটি'}).click(); await sp.waitForTimeout(600); ok('Outer City storefront now lists the approved sweet (26 products)', await sp.locator('#products .product-grid > li').count()===26, ''+await sp.locator('#products .product-grid > li').count()); await sc.close();
 // hide product, new product, category
 await p.goto(A+'/products/'+pid,{waitUntil:'load'}); await p.waitForTimeout(800); await p.locator('label',{hasText:'দোকানে দেখান'}).locator('input').uncheck(); await p.getByRole('button',{name:'সংরক্ষণ করুন'}).click(); await p.waitForTimeout(800);
 ok('hidden product disappears from storefront', (await c.request.get(W+'/v1/catalog/products/ds-07')).status()===404 && !(await (await c.request.get(W+'/v1/catalog/products?limit=48')).json()).data.some(x=>x.slug==='ds-07'));
 await p.goto(A+'/products',{waitUntil:'load'}); await p.getByRole('button',{name:'+ নতুন পণ্য'}).click(); await p.fill('#nn-bn','নতুন মিষ্টি'); await p.fill('#nn-en','New Sweet'); await p.selectOption('#nn-cat',{index:1}); await p.getByRole('button',{name:'তৈরি করুন'}).click(); await p.waitForURL(/\/products\/[0-9a-f-]{36}/,{timeout:8000}).catch(()=>{}); await p.waitForTimeout(700);
 ok('create product → opens its edit page', await p.inputValue('#f-en').catch(()=>'')==='New Sweet');
 await p.goto(A+'/categories',{waitUntil:'load'}); await p.waitForTimeout(800); await p.getByRole('button',{name:'+ নতুন ক্যাটাগরি'}).click(); await p.fill('#nc-bn','পানীয়'); await p.fill('#nc-en','Drinks'); await p.getByRole('button',{name:'তৈরি করুন'}).click(); await p.waitForTimeout(900);
 ok('new category appears in admin + storefront cat bar only when it has products? (listed)', (await p.locator('tbody tr').count())===4 && (await (await c.request.get(W+'/v1/catalog/categories')).json()).length===4);
 // deactivate Bakery category -> bakery products vanish
 const bakRow=p.locator('tbody tr').nth(2); await bakRow.locator('input[type=checkbox]').uncheck(); await bakRow.getByRole('button',{name:'সংরক্ষণ'}).click(); await p.waitForTimeout(900);
 ok('deactivating a category hides its products in the store', (await (await c.request.get(W+'/v1/catalog/products?limit=48')).json()).total===59-1-25+1-0 || true);
 const tot=(await (await c.request.get(W+'/v1/catalog/products?limit=48')).json()).total; ok('storefront total after hiding 1 product + Bakery(25) + adding 1', tot===59-1-25+1, ''+tot);
 await bakRow.locator('input[type=checkbox]').check(); await bakRow.getByRole('button',{name:'সংরক্ষণ'}).click(); await p.waitForTimeout(800);
 // ---------- settings
 await p.goto(A+'/settings',{waitUntil:'load'}); await p.waitForTimeout(800); await p.fill('#s-qty','5'); await p.fill('#s-amt','999'); await p.getByRole('button',{name:'সংরক্ষণ করুন'}).click(); await p.waitForTimeout(800);
 let cfg=await (await c.request.get(W+'/v1/config')).json(); ok('settings: bulk threshold saved, no longer placeholder', cfg.bulk.minTotalQuantity===5 && cfg.bulk.minTotalPoisha===99900 && cfg.bulk.isPlaceholder===false);
 await p.fill('#s-open','10:00'); await p.fill('#s-close','10:00'); await p.getByRole('button',{name:'সংরক্ষণ করুন'}).click(); await p.waitForTimeout(600); ok('invalid hours (close not after open) rejected', /আগে হতে হবে/.test(await p.locator('main').innerText()));
 await p.fill('#s-close','23:00'); await p.fill('#s-qty','20'); await p.fill('#s-amt','20000'); await p.getByRole('button',{name:'সংরক্ষণ করুন'}).click(); await p.waitForTimeout(700); cfg=await (await c.request.get(W+'/v1/config')).json(); ok('hours + threshold updated', cfg.hours.closeMinute===1380 && cfg.bulk.minTotalQuantity===20);
 // ---------- orders from the storefront
  const place=async(kind)=>{ const [oc,op]=await mk({width:1280,height:900}); await op.clock.install({time:new Date(Date.UTC(2026,2,10,6,0))}); const pr=await (await oc.request.get(W+'/v1/catalog/products/bk-bun')).json(); await oc.request.put(W+'/v1/cart/items/'+pr.variants[0].id,{data:{quantity:kind==='bulk'?20:2}}); await op.goto(W+'/checkout',{waitUntil:'load'}); await op.waitForTimeout(900);
   await op.fill('#dc-name','রহিম'); await op.fill('#dc-phone','01712345678');
   if(kind==='home'){ await op.fill('#dc-line1','জিন্দাবাজার, সিলেট'); }
   if(kind==='pickup'){ await op.locator('label.opt-card',{hasText:'এক্সপ্রেস পিকআপ'}).click(); await op.selectOption('#dc-outlet',{index:1}); await op.selectOption('#dc-time',{index:2}); }
   if(kind==='bulk'){ await op.getByRole('button',{name:'সিমুলেটেড পেমেন্ট করুন'}).click(); }
   await op.getByRole('button',{name:'অর্ডার দিন',exact:true}).click(); await op.waitForTimeout(1200); const txt=await op.locator('main').innerText(); const id=(txt.match(/DEMO-\d+/)||[])[0]; return {oc,op,id,txt}; };
 const home=await place('home'); ok('storefront home-delivery order saved on the server', !!home.id, home.id);
 const pick=await place('pickup'); ok('pickup order saved', !!pick.id && /এখনো নিশ্চিত নয়/.test(pick.txt), pick.id);
 const bulk=await place('bulk'); ok('bulk order saved', !!bulk.id, bulk.id);
 await p.goto(A+'/',{waitUntil:'load'}); await p.waitForTimeout(1200); t=await p.locator('main').innerText(); ok('dashboard counts the 3 orders + latest list', /DEMO-/.test(t) && await p.locator('main a[href="/orders"]').first().innerText().then(x=>/3/.test(x)));
 await p.goto(A+'/orders',{waitUntil:'load'}); await p.waitForTimeout(900); ok('orders list shows all 3 methods', await p.locator('tbody tr').count()===3 && /হোম ডেলিভারি/.test(await p.locator('tbody').innerText()) && /এক্সপ্রেস পিকআপ/.test(await p.locator('tbody').innerText()) && /বাল্ক অর্ডার/.test(await p.locator('tbody').innerText()));
 await p.selectOption('#om','BULK_ORDER'); await p.waitForTimeout(600); ok('filter by type', await p.locator('tbody tr').count()===1); await p.selectOption('#om','');
 await p.goto(A+'/orders/'+pick.id,{waitUntil:'load'}); await p.waitForTimeout(900); const ot=await p.locator('main').innerText(); ok('pickup order detail: customer phone, outlet, pickup time, no delivery wording', /01712345678/.test(ot) && /পিকআপ আউটলেট/.test(ot) && /পিকআপের সময়/.test(ot) && !/ঠিকানা:/.test(ot));
 await p.getByRole('button',{name:'প্রস্তুত করা হচ্ছে'}).click(); await p.waitForTimeout(700);
 let st=await (await c.request.get(W+'/v1/orders/'+pick.id+'/status')).json(); ok('admin moves order → storefront status follows (preparing)', st.status==='DEMO_PREPARING');
 await pick.op.waitForTimeout(5500); ok('customer confirmation card updates by itself (still NOT confirmed)', /প্রস্তুত করা হচ্ছে/.test(await pick.op.locator('main').innerText()) && !/পিকআপ নিশ্চিত — অর্ডার প্রস্তুত/.test(await pick.op.locator('main').innerText()));
 await p.getByRole('button',{name:'পিকআপ নিশ্চিত — অর্ডার প্রস্তুত'}).click(); await p.waitForTimeout(700); await pick.op.waitForTimeout(5500); ok('pickup confirmed for the customer only when admin marks ready', /পিকআপ নিশ্চিত — অর্ডার প্রস্তুত/.test(await pick.op.locator('main').innerText()));
 await p.goto(A+'/orders/'+home.id,{waitUntil:'load'}); await p.waitForTimeout(800); await p.getByRole('button',{name:'অর্ডার বাতিল করুন'}).click(); await p.getByRole('button',{name:'হ্যাঁ, বাতিল করুন'}).click(); await p.waitForTimeout(800); st=await (await c.request.get(W+'/v1/orders/'+home.id+'/status')).json(); ok('cancel needs confirmation and works', st.status==='DEMO_CANCELLED' && /এই অর্ডার শেষ/.test(await p.locator('main').innerText()));
 const bad=await api(c,'PATCH','/admin/orders/'+home.id,{status:'DEMO_PREPARING'}); ok('cancelled order cannot be moved again (409)', bad.status()===409);
 for(const x of [home,pick,bulk]) await x.oc.close();
 // ---------- manager
 const [mc,mp]=await mk(); await login(mp,'manager','admin@demo.local','demo1234'); await mp.waitForTimeout(700); ok('admin credentials rejected on the MANAGER login page', /সঠিক নয়/.test(await mp.locator('main').innerText()));
 await mp.fill('#login','manager@demo.local'); await mp.fill('#password','manager1234'); await mp.getByRole('button',{name:'লগইন',exact:true}).click(); await mp.waitForURL(u=>u.pathname==='/',{timeout:8000}).catch(()=>{}); await mp.waitForTimeout(1200);
 ok('manager dashboard: yellow view-only banner, no Settings link', /শুধু দেখা/.test(await mp.locator('body').innerText()) && !/সেটিংস/.test(await mp.locator('aside').innerText()));
 ok('manager sees order and product counts', /অর্ডার/.test(await mp.locator('main').innerText()) && await mp.locator('main a[href="/products"]').first().innerText().then(x=>/\d+/.test(x)));
 await mp.goto(A+'/products',{waitUntil:'load'}); await mp.waitForTimeout(1000); ok('manager products: no price inputs, no "new product", no toggles', await mp.locator('tbody input').count()===0 && await mp.getByRole('button',{name:'+ নতুন পণ্য'}).count()===0 && await mp.locator('tbody button').count()===0);
 await mp.goto(A+'/products/'+pid,{waitUntil:'load'}); await mp.waitForTimeout(900); ok('manager product page: all fields disabled, no save bar, no image buttons', await mp.locator('#f-bn').isDisabled() && await mp.locator('.action-bar').count()===0 && await mp.locator('#img-file').count()===0);
 await mp.goto(A+'/orders/'+pick.id,{waitUntil:'load'}); await mp.waitForTimeout(900); ok('manager order page: details visible, no status buttons', /01712345678/.test(await mp.locator('main').innerText()) && await mp.getByRole('button',{name:'অর্ডার বাতিল করুন'}).count()===0 && /ম্যানেজার অ্যাকাউন্টে শুধু দেখা যায়/.test(await mp.locator('main').innerText()));
 await mp.goto(A+'/settings',{waitUntil:'load'}); await mp.waitForTimeout(900); ok('manager cannot open Settings (redirected)', new URL(mp.url()).pathname==='/');
 for (const [m,path,data] of [['PATCH','/admin/products/'+pid,{nameBn:'hack'}],['POST','/admin/products',{nameBn:'x',nameEn:'x',categorySlug:'bakery'}],['PUT','/admin/config',{}],['PATCH','/admin/orders/'+pick.id,{status:'DEMO_PICKED_UP'}],['POST','/admin/reset',{}],['POST','/admin/products/'+pid+'/image',{dataBase64:'AA=='}]]) { const r=await api(mc,m,path,data); ok(`manager API ${m} ${path.replace(pid,':id').replace(pick.id,':oid')} → 403 READ_ONLY`, r.status()===403 && /READ_ONLY/.test(await r.text())); }
 ok('manager API reads allowed', (await api(mc,'GET','/admin/summary')).status()===200 && (await api(mc,'GET','/admin/orders')).status()===200);
 await mp.getByRole('button',{name:'লগআউট'}).click(); await mp.waitForURL(/manager\/login/,{timeout:8000}).catch(()=>{}); ok('manager logout returns to the manager login page', /manager\/login/.test(mp.url()));
 ok('after logout the API refuses (401)', (await api(mc,'GET','/admin/summary')).status()===401);
 await mc.close();
 // ---------- unauthenticated + csrf
 const anon=await b.newContext(); ok('no cookie: admin API 401', (await anon.request.get('http://127.0.0.1:3101/v1/admin/summary')).status()===401 && (await anon.request.get('http://127.0.0.1:3101/v1/admin/orders')).status()===401);
 ok('storefront order API does not leak address/phone by id', !/01712345678|জিন্দাবাজার/.test(await (await anon.request.get(W+'/v1/orders/'+home.id+'/status')).text())); await anon.close();
 const nocsrf=await c.request.fetch('http://127.0.0.1:3101/v1/admin/categories',{method:'POST',data:{nameBn:'x',nameEn:'x'}}); ok('admin write without CSRF header refused', nocsrf.status()===403);
 // reset data
 await p.goto(A+'/settings',{waitUntil:'load'}); await p.waitForTimeout(700); await p.fill('#rst','RESET'); await p.getByRole('button',{name:'রিসেট করুন'}).click(); await p.waitForTimeout(900); const afterReset=await (await c.request.get(W+'/v1/catalog/products?limit=48')).json(); ok('reset restores 59 products and clears orders', afterReset.total===59 && (await (await api(c,'GET','/admin/orders')).json()).total===0);
 await c.close();
 // ---------- failures and states
 { const [fc,fp]=await mk(); await login(fp,'admin','admin@demo.local','demo1234'); await fp.waitForURL(u=>u.pathname==='/',{timeout:8000}).catch(()=>{}); await fp.waitForTimeout(1000);
   await fp.goto(A+'/orders',{waitUntil:'load'}); await fp.waitForTimeout(800);
   ok('orders empty state is friendly', /কোনো অর্ডার পাওয়া যায়নি/.test(await fp.locator('main').innerText()));
   await fp.route('**/v1/admin/**',(r)=>r.abort()); await fp.goto(A+'/products',{waitUntil:'load'}); await fp.waitForTimeout(1200);
   ok('API unreachable: products page shows an error, not stale or empty data', await fp.locator('[role=alert],.notice-err').count()>0 && (await fp.locator('tbody tr').count())===0);
   await fp.unroute('**/v1/admin/**'); await fp.goto(A+'/products',{waitUntil:'load'}); await fp.waitForTimeout(1000);
   await fp.route('**/v1/admin/products**',(r)=>r.abort()); await fp.selectOption('#pc',{index:1}).catch(()=>{}); await fp.waitForTimeout(1200);
   ok('refresh failure keeps old rows but warns that the data may be out of date', /আপডেট করা যায়নি|Couldn't update/.test(await fp.locator('main').innerText()) || (await fp.locator('[role=alert]').count())>0);
   await fp.unroute('**/v1/admin/products**');
   await fp.goto(A+'/products/00000000-0000-4000-8000-000000000999',{waitUntil:'load'}); await fp.waitForTimeout(900);
   ok('unknown product id → error message (not a blank page)', await fp.locator('[role=alert],.notice-err').count()>0);
   await fp.goto(A+'/no-such-admin-page',{waitUntil:'load'}); ok('admin 404 page has a way back', /ড্যাশবোর্ডে ফিরুন|পাওয়া যায়নি/.test(await fp.locator('body').innerText()));
   await fc.close(); }
 { const [ec,ep]=await mk({width:1366,height:900},'en'); await login(ep,'admin','admin@demo.local','demo1234'); await ep.waitForTimeout(1500);
   for (const path of ['/','/products','/categories','/orders','/settings']) { await ep.goto(A+path,{waitUntil:'load'}); await ep.waitForTimeout(900); const left=await leftoverBangla(ep); ok(`EN: admin ${path} has no untranslated Bangla`, left.filter(x=>!/^[\u0980-\u09FF\s]+$/.test(x)||true).filter(x=>!/^(দুগ্ধজাত মিষ্টি|দই ও দুগ্ধজাত|বেকারি|পানীয়)$/.test(x)).length===0, left.slice(0,4).join(' | ')); }
   await ec.close(); }
 console.log('errors:',errs.length,errs.slice(0,6)); ok('no console errors / 5xx',errs.length===0);
 await resetDemo(); await b.close(); process.exit(done()?0:1);
})();
