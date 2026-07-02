import PostalMime from "postal-mime";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI_PROVIDER: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  GEMINI_TRANSCRIBE_MODEL: string;
  GEMINI_FALLBACK_MODELS: string;
  GEMINI_RETRY_ATTEMPTS: string;
  GEMINI_RETRY_BASE_DELAY_MS: string;
  PARSER_SERVICE_URL: string;
  PARSER_SERVICE_TOKEN: string;
  EMAIL_BRIDGE_URL: string;
  EMAIL_BRIDGE_TOKEN: string;
  EMAIL_INGEST_TOKEN: string;
  ONEC_MCP_BRIDGE_URL: string;
  ONEC_MCP_BRIDGE_TOKEN: string;
  ONEC_MCP_ALLOWED_TOOLS: string;
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_API_VERSION: string;
  ACCESS_USERNAME: string;
  ACCESS_PASSWORD: string;
}

type Metadata = {
  client_company?: string;
  client_contact_name?: string;
  michael_manager?: string;
  communication_channel?: string;
  priority?: string;
  next_action?: string;
};

type CrmLink = {
  clientId: number | null;
  contactId: number | null;
  michaelManagerId: number | null;
  clientType: "standard" | "vip";
  requiresContractAppendix: boolean;
};

type CurrentUser = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  email_address: string;
};

type FormValue = string | File;

type ParsedDocumentPage = {
  page_number?: number;
  text?: string;
  image_base64?: string;
  image_mime_type?: string;
  image_data_url?: string;
};

type ParsedDocument = {
  text?: string;
  pages?: ParsedDocumentPage[];
  parser?: string;
  warnings?: string[];
  filename?: string;
  extension?: string;
};

type ParsedImagePage = {
  pageNumber: number;
  payload: FilePayload;
};

type AiRuleDefinition = {
  rule_key: string;
  title: string;
  rule_text: string;
  is_enabled: number;
  is_required: number;
  sort_order: number;
};

type WhatsAppTemplateDefinition = {
  template_key: string;
  display_name: string;
  template_name: string;
  language_code: string;
  category: string;
  body_text: string;
  is_enabled: number;
  sort_order: number;
};

type EmailIngestPayload = {
  mailbox_name?: unknown;
  mailbox_email?: unknown;
  michael_manager?: unknown;
  message_uid?: unknown;
  from_address?: unknown;
  to_address?: unknown;
  subject?: unknown;
  body_text?: unknown;
  attachment_names?: unknown;
  attachment_text?: unknown;
  received_at?: unknown;
};

type EmailMessageInput = {
  mailbox_name: string | null;
  mailbox_email: string | null;
  michael_manager: string | null;
  message_uid: string;
  from_address: string | null;
  to_address: string | null;
  subject: string;
  body_text: string;
  attachment_names: string | null;
  attachment_text: string | null;
  received_at: string | null;
};

class UserInputError extends Error {
  status = 400;
}

type EmailFolder = "inbox" | "in_work" | "suppliers" | "buyers" | "done" | "trash";
type EmailStatus = "received" | "in_work" | "done" | "deleted";

const EMAIL_FOLDERS: EmailFolder[] = ["inbox", "in_work", "suppliers", "buyers", "done", "trash"];
const EMAIL_SENDER_ROUTE_FOLDERS: EmailFolder[] = ["suppliers", "buyers"];
const EMAIL_STATUSES: EmailStatus[] = ["received", "in_work", "done", "deleted"];
const DEFAULT_ONEC_MCP_ALLOWED_TOOLS = [
  "get_metadata_tree",
  "get_object_structure",
  "get_form_structure",
  "get_configuration_info",
  "search_code",
  "bsl_syntax_help",
  "execute_query",
  "validate_query",
  "get_event_log",
];

const ONEC_CLIENT_SEARCH_QUERY = `
ВЫБРАТЬ ПЕРВЫЕ 10
  Контрагенты.Ссылка КАК Контрагент,
  Контрагенты.Наименование КАК Наименование,
  Контрагенты.НаименованиеПолное КАК НаименованиеПолное,
  Контрагенты.ИНН КАК БИН,
  Контрагенты.Партнер КАК Партнер
ИЗ
  Справочник.Контрагенты КАК Контрагенты
ГДЕ
  НЕ Контрагенты.ПометкаУдаления
  И (
    Контрагенты.Наименование ПОДОБНО &Поиск
    ИЛИ Контрагенты.НаименованиеПолное ПОДОБНО &Поиск
    ИЛИ Контрагенты.ИНН ПОДОБНО &Поиск
    ИЛИ Контрагенты.Наименование ПОДОБНО &ПоискОчищенный
    ИЛИ Контрагенты.НаименованиеПолное ПОДОБНО &ПоискОчищенный
  )
УПОРЯДОЧИТЬ ПО
  Контрагенты.Наименование
`;

const ONEC_ITEM_SEARCH_QUERY = `
ВЫБРАТЬ ПЕРВЫЕ 10
  Номенклатура.Код КАК Код,
  Номенклатура.Артикул КАК Артикул,
  Номенклатура.Наименование КАК Наименование,
  Номенклатура.НаименованиеПолное КАК НаименованиеПолное,
  Номенклатура.ЕдиницаИзмерения КАК ЕдИзм,
  Номенклатура.СтавкаНДС КАК СтавкаНДС
ИЗ
  Справочник.Номенклатура КАК Номенклатура
ГДЕ
  НЕ Номенклатура.ПометкаУдаления
  И (
    Номенклатура.Наименование ПОДОБНО &Поиск
    ИЛИ Номенклатура.НаименованиеПолное ПОДОБНО &Поиск
    ИЛИ Номенклатура.Артикул ПОДОБНО &Поиск
    ИЛИ Номенклатура.Код ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Номенклатура.Наименование
`;

const ONEC_STOCK_SEARCH_QUERY = `
ВЫБРАТЬ ПЕРВЫЕ 20
  Остатки.Номенклатура КАК Номенклатура,
  Остатки.Склад КАК Склад,
  Остатки.ВНаличииОстаток КАК ВНаличии,
  Остатки.ВРезервеСоСкладаОстаток КАК ВРезервеСоСклада,
  Остатки.ВРезервеПодЗаказОстаток КАК ВРезервеПодЗаказ
ИЗ
  РегистрНакопления.СвободныеОстатки.Остатки() КАК Остатки
ГДЕ
  Остатки.Номенклатура.Наименование ПОДОБНО &Поиск
  ИЛИ Остатки.Номенклатура.Артикул ПОДОБНО &Поиск
УПОРЯДОЧИТЬ ПО
  Остатки.Номенклатура,
  Остатки.Склад
`;

const ONEC_PRICE_SEARCH_QUERY = `
ВЫБРАТЬ ПЕРВЫЕ 20
  Цены.Номенклатура КАК Номенклатура,
  Цены.Характеристика КАК Характеристика,
  Цены.ВидЦены КАК ВидЦены,
  Цены.Цена КАК Цена,
  Цены.Упаковка КАК Упаковка,
  Цены.Валюта КАК Валюта
ИЗ
  РегистрСведений.ЦеныНоменклатуры.СрезПоследних() КАК Цены
ГДЕ
  Цены.Номенклатура.Наименование ПОДОБНО &Поиск
  ИЛИ Цены.Номенклатура.Артикул ПОДОБНО &Поиск
УПОРЯДОЧИТЬ ПО
  Цены.Номенклатура,
  Цены.ВидЦены
`;

const ONEC_CLIENT_CONTRACT_QUERIES = [
  {
    key: "contracts_by_partner",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Договоры.Ссылка КАК Договор,
  Договоры.Наименование КАК Наименование,
  Договоры.Партнер КАК Партнер,
  Договоры.Организация КАК Организация,
  Договоры.ДействуетС КАК ДействуетС,
  Договоры.ДействуетПо КАК ДействуетПо
ИЗ
  Справочник.ДоговорыКонтрагентов КАК Договоры
ГДЕ
  НЕ Договоры.ПометкаУдаления
  И (
    Договоры.Партнер.Наименование ПОДОБНО &Поиск
    ИЛИ Договоры.Партнер.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Договоры.ДействуетС УБЫВ
`,
  },
  {
    key: "contracts_by_counterparty",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Договоры.Ссылка КАК Договор,
  Договоры.Наименование КАК Наименование,
  Договоры.Контрагент КАК Контрагент,
  Договоры.Организация КАК Организация
ИЗ
  Справочник.ДоговорыКонтрагентов КАК Договоры
ГДЕ
  НЕ Договоры.ПометкаУдаления
  И (
    Договоры.Контрагент.Наименование ПОДОБНО &Поиск
    ИЛИ Договоры.Контрагент.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Договоры.Наименование
`,
  },
  {
    key: "contracts_by_owner",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Договоры.Ссылка КАК Договор,
  Договоры.Наименование КАК Наименование,
  Договоры.Владелец КАК Владелец
ИЗ
  Справочник.ДоговорыКонтрагентов КАК Договоры
ГДЕ
  НЕ Договоры.ПометкаУдаления
  И (
    Договоры.Владелец.Наименование ПОДОБНО &Поиск
    ИЛИ Договоры.Владелец.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Договоры.Наименование
`,
  },
];

const ONEC_CLIENT_ORDER_QUERIES = [
  {
    key: "customer_orders_partner_counterparty",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 10
  Заказы.Ссылка КАК Заказ,
  Заказы.Номер КАК Номер,
  Заказы.Дата КАК Дата,
  Заказы.Партнер КАК Партнер,
  Заказы.Контрагент КАК Контрагент,
  Заказы.Организация КАК Организация,
  Заказы.СуммаДокумента КАК Сумма,
  Заказы.Валюта КАК Валюта,
  Заказы.Статус КАК Статус,
  Заказы.Проведен КАК Проведен
ИЗ
  Документ.ЗаказКлиента КАК Заказы
ГДЕ
  НЕ Заказы.ПометкаУдаления
  И (
    Заказы.Партнер.Наименование ПОДОБНО &Поиск
    ИЛИ Заказы.Партнер.НаименованиеПолное ПОДОБНО &Поиск
    ИЛИ Заказы.Контрагент.Наименование ПОДОБНО &Поиск
    ИЛИ Заказы.Контрагент.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Заказы.Дата УБЫВ
`,
  },
  {
    key: "customer_orders_counterparty",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 10
  Заказы.Ссылка КАК Заказ,
  Заказы.Номер КАК Номер,
  Заказы.Дата КАК Дата,
  Заказы.Контрагент КАК Контрагент,
  Заказы.Организация КАК Организация,
  Заказы.СуммаДокумента КАК Сумма,
  Заказы.Проведен КАК Проведен
ИЗ
  Документ.ЗаказКлиента КАК Заказы
ГДЕ
  НЕ Заказы.ПометкаУдаления
  И (
    Заказы.Контрагент.Наименование ПОДОБНО &Поиск
    ИЛИ Заказы.Контрагент.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Заказы.Дата УБЫВ
`,
  },
];

const ONEC_CLIENT_INVOICE_QUERIES = [
  {
    key: "customer_invoices_partner_counterparty",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Счета.Ссылка КАК Счет,
  Счета.Номер КАК Номер,
  Счета.Дата КАК Дата,
  Счета.Партнер КАК Партнер,
  Счета.Контрагент КАК Контрагент,
  Счета.Организация КАК Организация,
  Счета.СуммаДокумента КАК Сумма,
  Счета.Валюта КАК Валюта,
  Счета.Проведен КАК Проведен
ИЗ
  Документ.СчетНаОплатуКлиенту КАК Счета
ГДЕ
  НЕ Счета.ПометкаУдаления
  И (
    Счета.Партнер.Наименование ПОДОБНО &Поиск
    ИЛИ Счета.Партнер.НаименованиеПолное ПОДОБНО &Поиск
    ИЛИ Счета.Контрагент.Наименование ПОДОБНО &Поиск
    ИЛИ Счета.Контрагент.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Счета.Дата УБЫВ
`,
  },
  {
    key: "customer_invoices_counterparty",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Счета.Ссылка КАК Счет,
  Счета.Номер КАК Номер,
  Счета.Дата КАК Дата,
  Счета.Контрагент КАК Контрагент,
  Счета.Организация КАК Организация,
  Счета.СуммаДокумента КАК Сумма,
  Счета.Проведен КАК Проведен
ИЗ
  Документ.СчетНаОплатуКлиенту КАК Счета
ГДЕ
  НЕ Счета.ПометкаУдаления
  И (
    Счета.Контрагент.Наименование ПОДОБНО &Поиск
    ИЛИ Счета.Контрагент.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Счета.Дата УБЫВ
`,
  },
  {
    key: "buyer_invoices_counterparty",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Счета.Ссылка КАК Счет,
  Счета.Номер КАК Номер,
  Счета.Дата КАК Дата,
  Счета.Контрагент КАК Контрагент,
  Счета.СуммаДокумента КАК Сумма,
  Счета.Проведен КАК Проведен
ИЗ
  Документ.СчетНаОплатуПокупателю КАК Счета
ГДЕ
  НЕ Счета.ПометкаУдаления
  И (
    Счета.Контрагент.Наименование ПОДОБНО &Поиск
    ИЛИ Счета.Контрагент.НаименованиеПолное ПОДОБНО &Поиск
  )
УПОРЯДОЧИТЬ ПО
  Счета.Дата УБЫВ
`,
  },
];

const ONEC_CLIENT_DEBT_QUERIES = [
  {
    key: "settlements_with_customers",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Остатки.Партнер КАК Партнер,
  Остатки.Контрагент КАК Контрагент,
  Остатки.Договор КАК Договор,
  Остатки.СуммаОстаток КАК СуммаОстаток
ИЗ
  РегистрНакопления.РасчетыСКлиентами.Остатки() КАК Остатки
ГДЕ
  Остатки.Партнер.Наименование ПОДОБНО &Поиск
  ИЛИ Остатки.Контрагент.Наименование ПОДОБНО &Поиск
УПОРЯДОЧИТЬ ПО
  Остатки.СуммаОстаток УБЫВ
`,
  },
  {
    key: "mutual_settlements_with_customers",
    query: `
ВЫБРАТЬ ПЕРВЫЕ 20
  Остатки.Партнер КАК Партнер,
  Остатки.Контрагент КАК Контрагент,
  Остатки.СуммаОстаток КАК СуммаОстаток
ИЗ
  РегистрНакопления.ВзаиморасчетыСКлиентами.Остатки() КАК Остатки
ГДЕ
  Остатки.Партнер.Наименование ПОДОБНО &Поиск
  ИЛИ Остатки.Контрагент.Наименование ПОДОБНО &Поиск
УПОРЯДОЧИТЬ ПО
  Остатки.СуммаОстаток УБЫВ
`,
  },
];

const SESSION_COOKIE_NAME = "sales_ai_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

const REQUIRED_OUTPUT = `
Вывод должен строго содержать разделы:
A. Краткое резюме
B. Извлеченные данные
C. Решение для 1С
D. Черновик для клиента
E. Вопросы для уточнения
F. Финальный юридический статус сделки
`;

const SYSTEM_PROMPT = `
Вы — интеллектуальный ассистент менеджера по продажам ТОО Michael, Казахстан.
Работайте только по данным заявки. Не выдумывайте товары, цены, остатки, сроки, единицы измерения, аналоги или скидки.
Если данных нет, пишите «уточняется».
Если в заявке есть блок «Автоматическая проверка 1С», используйте эти данные как приоритетные справочные данные.
Если автоматическая проверка 1С не нашла цену, остаток, договор или товар, не придумывайте их.

Обязательные настройки:
- Все коммерческие предложения, счета и клиентские цены формируются от ТОО Michael.
- Для клиента всегда готовить цены в формате «с НДС». НДС для Казахстана — 16%, если документы сделки не говорят иное.
- Если видна цена со стороннего сайта/прайса, не использовать ее как финальную цену ТОО Michael без подтверждения.
- Клиент ТОО KBI Energy / KBI Energy / КБИ Энерджи — VIP/оптовый покупатель с высоким приоритетом.
- По ТОО KBI Energy работа идет по годовому договору. Каждый счет должен сопровождаться приложением к договору.
- В каждой заявке фиксировать компанию клиента, контакт/менеджера клиента, ответственного менеджера Michael и канал связи.
- Канал связи важен: WhatsApp, Telegram и Email считаются основными рабочими каналами. В разделе D готовить текст под указанный канал.
- Голосовые сообщения после транскрибации считать полноценным входящим запросом.
- Если входящий документ является счетом на оплату, в разделе B обязательно извлечь все строки табличной части без сокращений.
- Для счета в разделе B обязательно указать таблицу с колонками: Код, Наименование, Ед. изм., Кол-во, Цена с НДС 16%, Сумма с НДС 16%, Гарантия.
- Код товара, количество, цена и сумма из счета являются юридически значимыми данными для приложения к договору; нельзя заменять их словом «уточняется», если они видны в документе.

${REQUIRED_OUTPUT}
`;

const DEFAULT_AI_RULES: AiRuleDefinition[] = [
  {
    rule_key: "prices_with_vat",
    title: "Цены всегда с НДС",
    rule_text: "Все цены, суммы, коммерческие предложения и ответы клиенту готовить в формате с НДС 16%, если документ сделки прямо не говорит иное.",
    is_enabled: 1,
    is_required: 1,
    sort_order: 10,
  },
  {
    rule_key: "supplier_michael",
    title: "Поставщик ТОО Michael",
    rule_text: "Все счета, предложения и клиентские ответы оформляются от поставщика ТОО Michael. Не предлагать выставление счета от другой компании.",
    is_enabled: 1,
    is_required: 1,
    sort_order: 20,
  },
  {
    rule_key: "kbi_invoice_appendix",
    title: "KBI: счет + приложение",
    rule_text: "Для ТОО KBI Energy / KBI Energy Group всегда учитывать работу по годовому договору: счет выставляется в 1С, а к каждому счету нужно подготовить приложение к договору.",
    is_enabled: 1,
    is_required: 1,
    sort_order: 30,
  },
  {
    rule_key: "one_c_source",
    title: "1С главный источник данных",
    rule_text: "Карточки клиентов, договоры, реквизиты, номенклатура, коды товаров, остатки и цены брать из 1С или из загруженного документа 1С. Если данных нет, писать что нужно проверить в 1С.",
    is_enabled: 1,
    is_required: 1,
    sort_order: 40,
  },
  {
    rule_key: "invoice_only_in_1c",
    title: "Счет только через 1С",
    rule_text: "Программа и ИИ не создают финальный счет самостоятельно. Они готовят задачу, черновик ответа и данные для менеджера; счет выставляется только через 1С.",
    is_enabled: 1,
    is_required: 1,
    sort_order: 50,
  },
  {
    rule_key: "no_price_guessing",
    title: "Не придумывать цены",
    rule_text: "Запрещено придумывать цену, скидку, наличие, срок поставки или код товара. Если цена не видна в счете, прайсе или данных 1С, писать \"цену нужно проверить в 1С\".",
    is_enabled: 1,
    is_required: 1,
    sort_order: 60,
  },
];

const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplateDefinition[] = [
  {
    template_key: "order_received",
    display_name: "Заявка получена",
    template_name: "order_received",
    language_code: "ru",
    category: "UTILITY",
    body_text: "Здравствуйте! Получили вашу заявку. Проверим данные и подготовим ответ от ТОО Michael.",
    is_enabled: 1,
    sort_order: 10,
  },
  {
    template_key: "need_clarification",
    display_name: "Нужно уточнение",
    template_name: "need_clarification",
    language_code: "ru",
    category: "UTILITY",
    body_text: "Здравствуйте! Для подготовки точного предложения нужно уточнить детали по заявке.",
    is_enabled: 1,
    sort_order: 20,
  },
  {
    template_key: "price_ready",
    display_name: "Цена готова",
    template_name: "price_ready",
    language_code: "ru",
    category: "UTILITY",
    body_text: "Здравствуйте! Подготовили цену с НДС по вашей заявке. Отправляем детали.",
    is_enabled: 1,
    sort_order: 30,
  },
  {
    template_key: "invoice_appendix_ready",
    display_name: "Счет и приложение KBI готовы",
    template_name: "invoice_appendix_ready",
    language_code: "ru",
    category: "UTILITY",
    body_text: "Здравствуйте! Счет от ТОО Michael и приложение к договору подготовлены.",
    is_enabled: 1,
    sort_order: 40,
  },
];

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await storeRoutedEmail(env, message);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);

    try {
      await ensureInitialUser(env);

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        const user = await authenticateRequest(request, env);
        return json({ user });
      }
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        return login(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        return logout(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/email/ingest") {
        return ingestEmailMessage(request, env);
      }

      const currentUser = await authenticateRequest(request, env);
      if (!currentUser) return json({ detail: "Нужно войти в программу." }, 401);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ status: "ok", runtime: "cloudflare-workers" });
      }
      if (request.method === "GET" && url.pathname === "/api/parser/health") {
        return json(await checkParserService(env));
      }
      if (request.method === "GET" && url.pathname === "/api/1c/mcp/health") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await checkOneCMcpBridge(env));
      }
      if (request.method === "GET" && url.pathname === "/api/1c/mcp/tools") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await listOneCMcpTools(env));
      }
      if (request.method === "POST" && url.pathname === "/api/1c/mcp/tools/call") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await callOneCMcpTool(request, env));
      }
      if (request.method === "GET" && url.pathname === "/api/1c/status") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await getOneCBusinessStatus(env));
      }
      if (request.method === "POST" && url.pathname === "/api/1c/counterparties/search") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await searchOneCCounterparties(request, env));
      }
      if (request.method === "POST" && url.pathname === "/api/1c/products/search") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await searchOneCProducts(request, env));
      }
      if (request.method === "POST" && url.pathname === "/api/1c/products/stock-prices") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await getOneCStockAndPrices(request, env));
      }
      const oneCClientActionMatch = url.pathname.match(/^\/api\/1c\/clients\/(\d+)\/(contracts|orders|invoices|debt)$/);
      if (request.method === "GET" && oneCClientActionMatch) {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await getOneCClientBusinessData(env, Number(oneCClientActionMatch[1]), oneCClientActionMatch[2]));
      }
      if (request.method === "GET" && url.pathname === "/api/ai/rules") {
        return json(await listAiRules(env));
      }
      if (request.method === "PATCH" && url.pathname === "/api/ai/rules") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await updateAiRules(request, env));
      }
      if (request.method === "GET" && url.pathname === "/api/whatsapp/templates") {
        return json(await listWhatsAppTemplates(env));
      }
      if (request.method === "POST" && url.pathname === "/api/whatsapp/templates") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await createWhatsAppTemplate(request, env));
      }
      if (request.method === "PATCH" && url.pathname === "/api/whatsapp/templates") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await updateWhatsAppTemplates(request, env));
      }
      if (request.method === "GET" && url.pathname === "/api/whatsapp/health") {
        return json(checkWhatsAppCloudApi(env));
      }
      if (request.method === "GET" && url.pathname === "/api/users") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await listUsers(env));
      }
      if (request.method === "POST" && url.pathname === "/api/users") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await createUser(request, env));
      }
      const userPasswordMatch = url.pathname.match(/^\/api\/users\/(\d+)\/password$/);
      if (request.method === "PATCH" && userPasswordMatch) {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const user = await resetUserPassword(request, env, Number(userPasswordMatch[1]));
        return user ? json(user) : json({ detail: "Пользователь не найден." }, 404);
      }
      const userEmailMatch = url.pathname.match(/^\/api\/users\/(\d+)\/email$/);
      if (request.method === "PATCH" && userEmailMatch) {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const user = await updateUserEmail(request, env, Number(userEmailMatch[1]));
        return user ? json(user) : json({ detail: "Пользователь не найден." }, 404);
      }
      const userActiveMatch = url.pathname.match(/^\/api\/users\/(\d+)\/active$/);
      if (request.method === "PATCH" && userActiveMatch) {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const userId = Number(userActiveMatch[1]);
        if (userId === currentUser.id) return json({ detail: "Нельзя отключить текущего пользователя." }, 400);
        const payload = (await request.json()) as { is_active?: unknown };
        if (typeof payload.is_active !== "boolean") return json({ detail: "Передайте is_active true/false." }, 400);
        const user = await updateUserActive(env, userId, payload.is_active);
        return user ? json(user) : json({ detail: "Пользователь не найден." }, 404);
      }
      const crmOneCMatch = url.pathname.match(/^\/api\/crm\/clients\/(\d+)\/1c-counterparty$/);
      if (request.method === "PATCH" && crmOneCMatch) {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const client = await linkCrmClientOneCCounterparty(request, env, Number(crmOneCMatch[1]), currentUser);
        return client ? json(client) : json({ detail: "Клиент CRM не найден." }, 404);
      }
      if (request.method === "GET" && url.pathname === "/api/requests") {
        return json(await listRequests(env));
      }
      if (request.method === "GET" && url.pathname === "/api/tasks/open") {
        return json(await listOpenTasks(env));
      }
      if (request.method === "POST" && url.pathname === "/api/requests/text") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await processText(request, env));
      }
      if (request.method === "POST" && url.pathname === "/api/requests/upload") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await processUpload(request, env));
      }
      if (request.method === "GET" && url.pathname === "/api/crm/summary") {
        return json(await getCrmSummary(env));
      }
      if (request.method === "GET" && url.pathname === "/api/email/messages") {
        return json(await listEmailMessages(env, currentUser, url.searchParams.get("folder")));
      }
      if (request.method === "GET" && url.pathname === "/api/email/sender-filters") {
        return json(await listEmailSenderFilters(env));
      }
      if (request.method === "POST" && url.pathname === "/api/email/sender-filters") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await createEmailSenderFilter(request, env));
      }
      if (request.method === "GET" && url.pathname === "/api/email/smtp/health") {
        return json(await checkEmailBridge(env));
      }
      if (request.method === "POST" && url.pathname === "/api/email/check") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const totalSeen = await countEmailMessages(env, currentUser);
        return json({
          imported: 0,
          skipped: 0,
          total_seen: totalSeen,
          detail: `Писем в базе: ${totalSeen}. Новые письма поступают через IMAP-ingest из привязанных ящиков edel.kz.`,
        });
      }
      if (request.method === "POST" && url.pathname === "/api/email/send") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await sendEmailReply(request, env, currentUser));
      }
      if (request.method === "POST" && url.pathname === "/api/whatsapp/send-template") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await sendWhatsAppTemplateMessage(request, env, currentUser));
      }

      const emailProcessMatch = url.pathname.match(/^\/api\/email\/messages\/(\d+)\/process$/);
      if (request.method === "POST" && emailProcessMatch) {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const emailItem = await getEmailMessage(env, Number(emailProcessMatch[1]));
        if (!emailItem) return json({ detail: "Письмо не найдено." }, 404);
        if (!canAccessEmailMessage(currentUser, emailItem)) return json({ detail: "Недостаточно прав." }, 403);
        const item = await processEmailMessage(env, Number(emailProcessMatch[1]));
        return item ? json(item) : json({ detail: "Письмо не найдено." }, 404);
      }

      const emailSenderFilterMatch = url.pathname.match(/^\/api\/email\/sender-filters\/(\d+)$/);
      if (request.method === "DELETE" && emailSenderFilterMatch) {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await deleteEmailSenderFilter(env, Number(emailSenderFilterMatch[1])));
      }

      const emailMessageMatch = url.pathname.match(/^\/api\/email\/messages\/(\d+)$/);
      if (emailMessageMatch) {
        const emailId = Number(emailMessageMatch[1]);
        if (request.method === "GET") {
          const item = await getEmailMessage(env, emailId);
          if (item && !canAccessEmailMessage(currentUser, item)) return json({ detail: "Недостаточно прав." }, 403);
          return item ? json(item) : json({ detail: "Письмо не найдено." }, 404);
        }
        if (request.method === "PATCH") {
          if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const existing = await getEmailMessage(env, emailId);
          if (!existing) return json({ detail: "Письмо не найдено." }, 404);
          if (!canAccessEmailMessage(currentUser, existing)) return json({ detail: "Недостаточно прав." }, 403);
          const item = await updateEmailMessage(request, env, emailId);
          return item ? json(item) : json({ detail: "Письмо не найдено." }, 404);
        }
        if (request.method === "DELETE") {
          if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const existing = await getEmailMessage(env, emailId);
          if (!existing) return json({ detail: "Письмо не найдено." }, 404);
          if (!canAccessEmailMessage(currentUser, existing)) return json({ detail: "Недостаточно прав." }, 403);
          const item = await moveEmailMessageToTrash(env, emailId);
          return item ? json(item) : json({ detail: "Письмо не найдено." }, 404);
        }
      }

      const requestMatch = url.pathname.match(/^\/api\/requests\/(\d+)$/);
      if (request.method === "GET" && requestMatch) {
        const item = await getRequest(env, Number(requestMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }
      if (request.method === "DELETE" && requestMatch) {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const result = await deleteRequest(env, Number(requestMatch[1]));
        return result ? json(result) : json({ detail: "Заявка не найдена." }, 404);
      }

      const statusMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/status$/);
      if (request.method === "PATCH" && statusMatch) {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const item = await updateRequestStatus(request, env, Number(statusMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      const dealDocsMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/deal-documents$/);
      if (request.method === "PATCH" && dealDocsMatch) {
        if (!canManageDocuments(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const item = await updateDealDocuments(request, env, Number(dealDocsMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      const appendixMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/contract-appendix$/);
      if (request.method === "POST" && appendixMatch) {
        if (!canManageDocuments(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const appendix = await generateContractAppendix(env, Number(appendixMatch[1]), currentUser);
        return appendix ? json(appendix) : json({ detail: "Заявка не найдена." }, 404);
      }

      const tasksMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/tasks$/);
      if (tasksMatch) {
        const requestId = Number(tasksMatch[1]);
        if (request.method === "GET") return json(await listRequestTasks(env, requestId));
        if (request.method === "POST") {
          if (!canManageTasks(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const task = await createRequestTask(request, env, requestId);
          return task ? json(task) : json({ detail: "Заявка не найдена." }, 404);
        }
      }

      const taskMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/tasks\/(\d+)$/);
      if (taskMatch) {
        if (request.method === "PATCH") {
          if (!canManageTasks(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const task = await updateRequestTask(request, env, Number(taskMatch[1]), Number(taskMatch[2]));
          return task ? json(task) : json({ detail: "Задача не найдена." }, 404);
        }
        if (request.method === "DELETE") {
          if (!canManageTasks(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const result = await deleteRequestTask(env, Number(taskMatch[1]), Number(taskMatch[2]), currentUser);
          return result ? json(result) : json({ detail: "Задача не найдена." }, 404);
        }
      }

      const eventsMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/events$/);
      if (request.method === "GET" && eventsMatch) {
        return json(await listRequestEvents(env, Number(eventsMatch[1])));
      }

      return json({ detail: "Endpoint не найден." }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      const status = error instanceof UserInputError ? error.status : 500;
      return json({ detail: message }, status);
    }
  },
} satisfies ExportedHandler<Env>;

async function ensureInitialUser(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_users").first() as Record<string, unknown> | null;
  if (Number(row?.count || 0) > 0) return;
  if (!env.ACCESS_PASSWORD) throw new Error("ACCESS_PASSWORD не задан. Нельзя создать первого пользователя.");

  const username = normalizeUsername(env.ACCESS_USERNAME || "manager");
  const password = await hashPassword(env.ACCESS_PASSWORD);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO app_users (username, display_name, role, password_hash, password_salt)
    VALUES (?, ?, ?, ?, ?)
  `).bind(username, "Администратор", "admin", password.hash, password.salt).run();
}

async function login(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json()) as { username?: string; password?: string };
  const username = normalizeUsername(payload.username || "");
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!username || !password) return json({ detail: "Введите имя пользователя и пароль." }, 400);

  const user = await env.DB.prepare(`
    SELECT * FROM app_users WHERE username = ? AND is_active = 1
  `).bind(username).first() as Record<string, any> | null;

  if (!user || !(await verifyPassword(password, String(user.password_salt), String(user.password_hash)))) {
    return json({ detail: "Неверное имя пользователя или пароль." }, 401);
  }

  const token = generateSessionToken();
  const tokenHash = await sha256Base64(token);
  const expiresAt = toSqlDateTime(new Date(Date.now() + SESSION_TTL_SECONDS * 1000));

  await env.DB.prepare(`
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).bind(Number(user.id), tokenHash, expiresAt).run();
  await env.DB.prepare(`
    UPDATE app_users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).bind(Number(user.id)).run();

  const currentUser = userToCurrentUser(user);
  return jsonWithHeaders({ user: currentUser }, 200, {
    "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS),
  });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (token) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256Base64(token)).run();
  }
  return jsonWithHeaders({ ok: true }, 200, {
    "Set-Cookie": buildSessionCookie(request, "", 0),
  });
}

async function authenticateRequest(request: Request, env: Env): Promise<CurrentUser | null> {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;

  const tokenHash = await sha256Base64(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.email_address
    FROM auth_sessions s
    INNER JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.expires_at > datetime('now')
      AND u.is_active = 1
  `).bind(tokenHash).first() as Record<string, any> | null;
  if (!row) return null;

  await env.DB.prepare(`
    UPDATE auth_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?
  `).bind(tokenHash).run();

  return userToCurrentUser(row);
}

async function listUsers(env: Env) {
  const result = await env.DB.prepare(`
    SELECT id, username, display_name, role, email_address, is_active, created_at, updated_at, last_login_at
    FROM app_users
    ORDER BY id ASC
  `).all();
  return result.results;
}

async function createUser(request: Request, env: Env) {
  const payload = (await request.json()) as {
    username?: string;
    display_name?: string;
    role?: string;
    email_address?: string;
    password?: string;
  };
  const username = normalizeUsername(payload.username || "");
  const displayName = normalizeOptionalText(payload.display_name) || username;
  const role = normalizeRole(payload.role);
  const emailAddress = normalizeEdelEmailAddress(payload.email_address);
  const passwordValue = typeof payload.password === "string" ? payload.password : "";
  if (!username) throw new Error("Имя пользователя пустое.");
  if (passwordValue.length < 8) throw new Error("Пароль должен быть не короче 8 символов.");
  await ensureUserEmailAvailable(env, emailAddress);

  const password = await hashPassword(passwordValue);
  const result = await env.DB.prepare(`
    INSERT INTO app_users (username, display_name, role, email_address, password_hash, password_salt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(username, displayName, role, emailAddress || null, password.hash, password.salt).run();
  const id = Number(result.meta.last_row_id);
  if (emailAddress) {
    await assignExistingEmailsToUser(env, emailAddress, displayName || username);
  }
  return env.DB.prepare(`
    SELECT id, username, display_name, role, email_address, is_active, created_at, updated_at, last_login_at
    FROM app_users WHERE id = ?
  `).bind(id).first();
}

async function resetUserPassword(request: Request, env: Env, userId: number) {
  const payload = (await request.json()) as { password?: string };
  const passwordValue = typeof payload.password === "string" ? payload.password : "";
  if (passwordValue.length < 8) throw new Error("Пароль должен быть не короче 8 символов.");

  const password = await hashPassword(passwordValue);
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET password_hash = ?, password_salt = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(password.hash, password.salt, userId).run();
  if (!result.meta.changes) return null;
  await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
  return env.DB.prepare(`
    SELECT id, username, display_name, role, email_address, is_active, created_at, updated_at, last_login_at
    FROM app_users WHERE id = ?
  `).bind(userId).first();
}

async function updateUserEmail(request: Request, env: Env, userId: number) {
  const payload = (await request.json()) as { email_address?: unknown };
  const emailAddress = normalizeEdelEmailAddress(payload.email_address);
  const existing = await env.DB.prepare(`
    SELECT id, username, display_name, email_address
    FROM app_users
    WHERE id = ?
  `).bind(userId).first() as Record<string, any> | null;
  if (!existing) return null;
  await ensureUserEmailAvailable(env, emailAddress, userId);

  const result = await env.DB.prepare(`
    UPDATE app_users
    SET email_address = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(emailAddress || null, userId).run();
  if (!result.meta.changes) return null;

  if (emailAddress) {
    const managerName = normalizeOptionalText(existing.display_name) || normalizeOptionalText(existing.username);
    await assignExistingEmailsToUser(env, emailAddress, managerName);
  }

  return env.DB.prepare(`
    SELECT id, username, display_name, role, email_address, is_active, created_at, updated_at, last_login_at
    FROM app_users WHERE id = ?
  `).bind(userId).first();
}

async function ensureUserEmailAvailable(env: Env, emailAddress: string, userId: number | null = null): Promise<void> {
  if (!emailAddress) return;

  const existing = await env.DB.prepare(`
    SELECT id
    FROM app_users
    WHERE email_address = ?
  `).bind(emailAddress).first() as Record<string, unknown> | null;
  if (existing && Number(existing.id) !== Number(userId)) {
    throw new UserInputError("Этот email уже привязан к другому пользователю.");
  }
}

async function updateUserActive(env: Env, userId: number, isActive: boolean) {
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(isActive ? 1 : 0, userId).run();
  if (!result.meta.changes) return null;

  if (!isActive) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
  }

  return env.DB.prepare(`
    SELECT id, username, display_name, role, email_address, is_active, created_at, updated_at, last_login_at
    FROM app_users WHERE id = ?
  `).bind(userId).first();
}

async function ensureDefaultAiRules(env: Env): Promise<void> {
  const statements = DEFAULT_AI_RULES.map((rule) => env.DB.prepare(`
    INSERT OR IGNORE INTO ai_rules (
      rule_key, title, rule_text, is_enabled, is_required, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    rule.rule_key,
    rule.title,
    rule.rule_text,
    rule.is_enabled,
    rule.is_required,
    rule.sort_order,
  ));
  if (statements.length) await env.DB.batch(statements);
}

async function listAiRules(env: Env) {
  await ensureDefaultAiRules(env);
  const result = await env.DB.prepare(`
    SELECT id, rule_key, title, rule_text, is_enabled, is_required, sort_order, updated_at
    FROM ai_rules
    ORDER BY sort_order ASC, id ASC
  `).all();
  return result.results;
}

async function updateAiRules(request: Request, env: Env) {
  const payload = (await request.json()) as {
    rules?: Array<{
      id?: unknown;
      rule_key?: unknown;
      rule_text?: unknown;
      is_enabled?: unknown;
    }>;
  };
  const rules = Array.isArray(payload.rules) ? payload.rules : [];
  if (!rules.length) throw new Error("Нет правил для сохранения.");

  await ensureDefaultAiRules(env);
  const existingRules = await listAiRules(env) as Array<Record<string, any>>;
  const existingByKey = new Map(existingRules.map((rule) => [String(rule.rule_key), rule]));
  const statements: D1PreparedStatement[] = [];

  for (const incoming of rules) {
    const ruleKey = typeof incoming.rule_key === "string" ? incoming.rule_key : "";
    const existing = existingByKey.get(ruleKey);
    if (!existing) continue;

    const ruleText = normalizeOptionalText(incoming.rule_text);
    if (!ruleText) throw new Error(`Правило "${existing.title}" не может быть пустым.`);

    const isRequired = Number(existing.is_required) === 1;
    const isEnabled = isRequired ? 1 : incoming.is_enabled === false ? 0 : 1;
    statements.push(env.DB.prepare(`
      UPDATE ai_rules
      SET rule_text = ?, is_enabled = ?, updated_at = datetime('now')
      WHERE rule_key = ?
    `).bind(ruleText, isEnabled, ruleKey));
  }

  if (statements.length) await env.DB.batch(statements);
  return listAiRules(env);
}

async function ensureDefaultWhatsAppTemplates(env: Env): Promise<void> {
  const statements = DEFAULT_WHATSAPP_TEMPLATES.map((template) => env.DB.prepare(`
    INSERT OR IGNORE INTO whatsapp_templates (
      template_key, display_name, template_name, language_code, category, body_text, is_enabled, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    template.template_key,
    template.display_name,
    template.template_name,
    template.language_code,
    template.category,
    template.body_text,
    template.is_enabled,
    template.sort_order,
  ));
  if (statements.length) await env.DB.batch(statements);
}

async function listWhatsAppTemplates(env: Env) {
  await ensureDefaultWhatsAppTemplates(env);
  const result = await env.DB.prepare(`
    SELECT id, template_key, display_name, template_name, language_code, category, body_text, is_enabled, sort_order, updated_at
    FROM whatsapp_templates
    ORDER BY sort_order ASC, id ASC
  `).all();
  return result.results;
}

async function updateWhatsAppTemplates(request: Request, env: Env) {
  const payload = (await request.json()) as {
    templates?: Array<{
      template_key?: unknown;
      display_name?: unknown;
      template_name?: unknown;
      language_code?: unknown;
      category?: unknown;
      body_text?: unknown;
      is_enabled?: unknown;
    }>;
  };
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  if (!templates.length) throw new Error("Нет шаблонов для сохранения.");

  await ensureDefaultWhatsAppTemplates(env);
  const existingTemplates = await listWhatsAppTemplates(env) as Array<Record<string, any>>;
  const existingByKey = new Map(existingTemplates.map((template) => [String(template.template_key), template]));
  const statements: D1PreparedStatement[] = [];

  for (const incoming of templates) {
    const templateKey = typeof incoming.template_key === "string" ? incoming.template_key : "";
    if (!existingByKey.has(templateKey)) continue;

    const displayName = normalizeOptionalText(incoming.display_name);
    const templateName = normalizeWhatsAppTemplateName(incoming.template_name);
    const languageCode = normalizeWhatsAppLanguageCode(incoming.language_code);
    const category = normalizeWhatsAppTemplateCategory(incoming.category);
    const bodyText = normalizeOptionalText(incoming.body_text);
    const isEnabled = incoming.is_enabled === false ? 0 : 1;

    if (!displayName) throw new Error("Название шаблона не может быть пустым.");
    if (!templateName) throw new Error(`Укажите точное имя Meta template для "${displayName}".`);
    if (!bodyText) throw new Error(`Текст-подсказка шаблона "${displayName}" не может быть пустым.`);

    statements.push(env.DB.prepare(`
      UPDATE whatsapp_templates
      SET display_name = ?, template_name = ?, language_code = ?, category = ?, body_text = ?, is_enabled = ?, updated_at = datetime('now')
      WHERE template_key = ?
    `).bind(displayName, templateName, languageCode, category, bodyText, isEnabled, templateKey));
  }

  if (statements.length) await env.DB.batch(statements);
  return listWhatsAppTemplates(env);
}

async function createWhatsAppTemplate(request: Request, env: Env) {
  const payload = (await request.json()) as {
    template_key?: unknown;
    display_name?: unknown;
    template_name?: unknown;
    language_code?: unknown;
    category?: unknown;
    body_text?: unknown;
  };
  const displayName = normalizeOptionalText(payload.display_name);
  const templateName = normalizeWhatsAppTemplateName(payload.template_name);
  const templateKey = normalizeWhatsAppTemplateKey(payload.template_key) || templateName;
  const languageCode = normalizeWhatsAppLanguageCode(payload.language_code);
  const category = normalizeWhatsAppTemplateCategory(payload.category);
  const bodyText = normalizeOptionalText(payload.body_text);

  if (!displayName) throw new Error("Название шаблона не может быть пустым.");
  if (!templateName) throw new Error("Укажите точное имя утвержденного Meta template.");
  if (!bodyText) throw new Error("Текст-подсказка шаблона не может быть пустым.");

  await ensureDefaultWhatsAppTemplates(env);
  const sortRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM whatsapp_templates").first() as Record<string, unknown> | null;
  const sortOrder = Number(sortRow?.next_order || 100);
  try {
    await env.DB.prepare(`
      INSERT INTO whatsapp_templates (
        template_key, display_name, template_name, language_code, category, body_text, is_enabled, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(templateKey, displayName, templateName, languageCode, category, bodyText, sortOrder).run();
  } catch {
    throw new Error("Шаблон с таким ключом или именем уже есть в программе.");
  }

  return listWhatsAppTemplates(env);
}

async function processText(request: Request, env: Env) {
  const payload = (await request.json()) as Metadata & { original_text?: string };
  const body = (payload.original_text || "").trim();
  if (!body) throw new Error("Текст заявки пустой.");

  let originalText = buildContextPrefix(payload) + body;
  originalText = await appendOneCAnalysisContext(env, payload, originalText);
  const aiResult = await analyzeText(env, originalText);
  return insertRequest(env, {
    source_type: "text",
    ...payload,
    original_text: originalText,
    uploaded_file_name: null,
    ai_result: aiResult,
  });
}

async function processUpload(request: Request, env: Env) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!isUploadedFile(file)) throw new Error("Файл не передан.");

  const metadata: Metadata = {
    client_company: stringValue(formData.get("client_company")),
    client_contact_name: stringValue(formData.get("client_contact_name")),
    michael_manager: stringValue(formData.get("michael_manager")),
    communication_channel: stringValue(formData.get("communication_channel")),
    priority: stringValue(formData.get("priority")),
    next_action: stringValue(formData.get("next_action")),
  };
  const managerNote = stringValue(formData.get("manager_note"));
  const context = buildContextPrefix(metadata);
  const fileName = file.name || "uploaded-file";
  const lowerName = fileName.toLowerCase();

  let originalText = "";
  let aiResult = "";
  let sourceType = "file";

  if (isImage(lowerName)) {
    const filePayload = await fileToPayload(file);
    originalText = `${context}Загружено изображение для vision-анализа: ${fileName}`;
    if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;
    const oneCContext = await buildOneCAnalysisContext(env, metadata, `${context}\n${managerNote}\n${fileName}`);
    originalText = appendTextBlock(originalText, oneCContext);
    aiResult = await analyzeImage(env, filePayload, fileName, appendTextBlock(`${context}${managerNote}`.trim(), oneCContext));
    sourceType = "image";
  } else if (isAudio(lowerName)) {
    const transcription = await transcribeAudio(env, file, managerNote);
    originalText = `${context}Голосовое сообщение: ${fileName}\n\nТранскрибация:\n${transcription}`;
    if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;
    originalText = await appendOneCAnalysisContext(env, metadata, originalText);
    aiResult = await analyzeText(env, originalText);
    sourceType = "audio";
  } else if (isDocument(lowerName)) {
    if (isPdf(lowerName) && useGemini(env) && !isParserServiceConfigured(env)) {
      const filePayload = await fileToPayload(file);
      originalText = `${context}PDF-файл обработан напрямую через Gemini: ${fileName}`;
      if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;
      const oneCContext = await buildOneCAnalysisContext(env, metadata, `${context}\n${managerNote}\n${fileName}`);
      originalText = appendTextBlock(originalText, oneCContext);
      aiResult = await analyzePdfGemini(env, filePayload, fileName, appendTextBlock(`${context}${managerNote}`.trim(), oneCContext));
    } else {
      const parsed = await parseDocumentWithService(env, file);
      const parsedText = parsedDocumentText(parsed);
      const warningsText = parsed.warnings?.length
        ? `\n\nПредупреждения parser-service:\n${parsed.warnings.join("\n")}`
        : "";
      originalText = `${context}Файл: ${fileName}\nParser: ${parsed.parser || "parser-service"}${warningsText}`;
      if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;

      if (parsedText) {
        originalText += `\n\nИзвлеченный текст:\n${limitText(parsedText, 120000)}`;
        originalText = await appendOneCAnalysisContext(env, metadata, originalText);
        aiResult = await analyzeText(env, originalText);
      } else {
        const imagePages = parsedImagePages(parsed);
        if (!imagePages.length) {
          throw new Error("Parser service не нашел текст и не вернул изображения страниц для vision-анализа.");
        }
        originalText += `\n\nДокумент похож на скан. Parser service вернул ${imagePages.length} страниц для vision-анализа.`;
        const oneCContext = await buildOneCAnalysisContext(env, metadata, `${context}\n${managerNote}\n${fileName}`);
        originalText = appendTextBlock(originalText, oneCContext);
        aiResult = await analyzeDocumentImages(env, imagePages, fileName, appendTextBlock(`${context}${managerNote}`.trim(), oneCContext));
      }
    }
  } else {
    const text = await file.text().catch(() => "");
    originalText = `${context}Файл: ${fileName}\n\n${managerNote ? `Пояснение менеджера:\n${managerNote}\n\n` : ""}${text || "Текст файла не извлечен. Поддерживаются изображения, голосовые файлы и документы PDF/DOCX/XLSX через parser-service."}`;
    originalText = await appendOneCAnalysisContext(env, metadata, originalText);
    aiResult = await analyzeText(env, originalText);
  }

  return insertRequest(env, {
    source_type: sourceType,
    ...metadata,
    original_text: originalText,
    uploaded_file_name: fileName,
    ai_result: aiResult,
  });
}

async function checkParserService(env: Env) {
  const baseUrl = (env.PARSER_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
      status: "not_configured",
      detail: "PARSER_SERVICE_URL не задан.",
    };
  }

  let serviceOrigin = baseUrl;
  try {
    serviceOrigin = new URL(baseUrl).origin;
  } catch {
    return {
      configured: true,
      reachable: false,
      status: "invalid_url",
      detail: "PARSER_SERVICE_URL задан в неверном формате.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = new Headers();
    if (env.PARSER_SERVICE_TOKEN) headers.set("X-Parser-Token", env.PARSER_SERVICE_TOKEN);

    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        configured: true,
        reachable: false,
        status: "error",
        service_origin: serviceOrigin,
        detail: data?.detail || raw || response.statusText,
      };
    }

    return {
      configured: true,
      reachable: true,
      status: data?.status || "ok",
      service: data?.service || "parser-service",
      service_origin: serviceOrigin,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parser-service недоступен.";
    return {
      configured: true,
      reachable: false,
      status: "unreachable",
      service_origin: serviceOrigin,
      detail: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkOneCMcpBridge(env: Env) {
  const baseUrl = (env.ONEC_MCP_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
      status: "not_configured",
      detail: "ONEC_MCP_BRIDGE_URL не задан.",
    };
  }

  let serviceOrigin = baseUrl;
  try {
    serviceOrigin = new URL(baseUrl).origin;
  } catch {
    return {
      configured: true,
      reachable: false,
      status: "invalid_url",
      detail: "ONEC_MCP_BRIDGE_URL задан в неверном формате.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: oneCMcpBridgeHeaders(env),
      signal: controller.signal,
    });
    const { raw, data } = await readJsonResponse(response);

    if (!response.ok) {
      return {
        configured: true,
        reachable: false,
        status: "error",
        service_origin: serviceOrigin,
        detail: data?.detail || raw || response.statusText,
      };
    }

    return {
      configured: true,
      reachable: true,
      status: data?.status || "ok",
      service: data?.service || "onec-mcp-bridge",
      service_origin: serviceOrigin,
      tools_count: Number(data?.tools_count || 0),
      allowed_tools: Array.isArray(data?.allowed_tools) ? data.allowed_tools : oneCMcpAllowedTools(env),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "1C MCP bridge недоступен.";
    return {
      configured: true,
      reachable: false,
      status: "unreachable",
      service_origin: serviceOrigin,
      detail: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function listOneCMcpTools(env: Env) {
  const baseUrl = oneCMcpBridgeBaseUrl(env);
  const response = await fetch(`${baseUrl}/tools`, {
    method: "GET",
    headers: oneCMcpBridgeHeaders(env),
  });
  const { raw, data } = await readJsonResponse(response);
  if (!response.ok) throw new Error(data?.detail || raw || "Не удалось получить список MCP-инструментов 1С.");
  return data || { tools: [], allowed_tools: oneCMcpAllowedTools(env) };
}

async function executeOneCMcpTool(env: Env, toolName: string, toolArguments: Record<string, unknown>) {
  const normalizedToolName = normalizeMcpToolName(toolName);
  if (!normalizedToolName) throw new UserInputError("Укажите MCP-инструмент 1С.");
  if (!oneCMcpAllowedTools(env).includes(normalizedToolName)) throw new UserInputError("Этот MCP-инструмент 1С не разрешен.");

  const baseUrl = oneCMcpBridgeBaseUrl(env);
  const response = await fetch(`${baseUrl}/tools/call`, {
    method: "POST",
    headers: oneCMcpBridgeHeaders(env, true),
    body: JSON.stringify({ name: normalizedToolName, arguments: toolArguments }),
  });
  const { raw, data } = await readJsonResponse(response);
  if (!response.ok) throw new Error(data?.detail || raw || "Не удалось выполнить MCP-инструмент 1С.");
  return data;
}

async function callOneCMcpTool(request: Request, env: Env) {
  const payload = (await request.json()) as { name?: unknown; tool_name?: unknown; arguments?: unknown };
  const toolName = normalizeMcpToolName(payload.name || payload.tool_name);
  const toolArguments = payload.arguments && typeof payload.arguments === "object" && !Array.isArray(payload.arguments)
    ? payload.arguments as Record<string, unknown>
    : {};
  return executeOneCMcpTool(env, toolName, toolArguments);
}

async function getOneCBusinessStatus(env: Env) {
  const health = await checkOneCMcpBridge(env);
  let configurationText = "";
  if (health.reachable) {
    const configuration = await executeOneCMcpTool(env, "get_configuration_info", {});
    configurationText = oneCMcpResultText(configuration);
  }
  return {
    health,
    configuration_text: configurationText,
  };
}

async function searchOneCCounterparties(request: Request, env: Env) {
  const { search } = await oneCSearchPayload(request, "Введите название клиента или БИН.");
  const result = await executeOneCMcpTool(env, "execute_query", {
    query: ONEC_CLIENT_SEARCH_QUERY,
    parameters: oneCClientSearchParameters(search),
    limit: 10,
  });
  const resultText = oneCMcpResultText(result);
  const items = parseOneCCounterpartyCandidates(resultText);
  return {
    tool: "find_counterparty",
    search,
    result_text: resultText,
    items,
    has_multiple: items.length > 1,
    raw: result,
  };
}

async function searchOneCProducts(request: Request, env: Env) {
  const { pattern, search } = await oneCSearchPayload(request, "Введите артикул, код или часть наименования товара.");
  const result = await executeOneCMcpTool(env, "execute_query", {
    query: ONEC_ITEM_SEARCH_QUERY,
    parameters: { Поиск: pattern },
    limit: 10,
  });
  return {
    tool: "find_product",
    search,
    result_text: oneCMcpResultText(result),
    raw: result,
  };
}

async function getOneCStockAndPrices(request: Request, env: Env) {
  const { pattern, search } = await oneCSearchPayload(request, "Введите артикул, код или часть наименования товара.");
  const [stockResult, priceResult] = await Promise.all([
    executeOneCMcpTool(env, "execute_query", {
      query: ONEC_STOCK_SEARCH_QUERY,
      parameters: { Поиск: pattern },
      limit: 20,
    }),
    executeOneCMcpTool(env, "execute_query", {
      query: ONEC_PRICE_SEARCH_QUERY,
      parameters: { Поиск: pattern },
      limit: 20,
    }),
  ]);
  return {
    tool: "get_stock_and_prices",
    search,
    stock_result_text: oneCMcpResultText(stockResult),
    price_result_text: oneCMcpResultText(priceResult),
    raw: {
      stock: stockResult,
      prices: priceResult,
    },
  };
}

async function getOneCClientBusinessData(env: Env, clientId: number, action: string) {
  const client = await getCrmClientForOneC(env, clientId);
  if (!client) throw new UserInputError("CRM-клиент не найден.");

  const descriptor = oneCClientActionDescriptor(action);
  const search = oneCClientSearchText(client);
  if (!search) throw new UserInputError("У CRM-клиента нет названия, БИН или привязки 1С для поиска.");

  const result = await executeFirstSuccessfulOneCQuery(env, descriptor.queries, {
    Поиск: oneCSearchPattern(search),
    БИН: client.onec_counterparty_bin || "",
  });

  return {
    tool: descriptor.tool,
    title: descriptor.title,
    client_id: clientId,
    client_name: client.display_name,
    onec_counterparty_name: client.onec_counterparty_name || client.onec_counterparty_full_name || null,
    onec_counterparty_bin: client.onec_counterparty_bin || null,
    onec_counterparty_ref: client.onec_counterparty_ref || null,
    search,
    query_key: result.queryKey,
    result_text: result.text,
    raw: result.raw,
    query_errors: result.errors,
  };
}

function oneCClientActionDescriptor(action: string) {
  const descriptors: Record<string, { tool: string; title: string; queries: Array<{ key: string; query: string }> }> = {
    contracts: {
      tool: "get_client_contracts",
      title: "Договоры клиента в 1С",
      queries: ONEC_CLIENT_CONTRACT_QUERIES,
    },
    orders: {
      tool: "get_client_orders",
      title: "Последние заказы клиента в 1С",
      queries: ONEC_CLIENT_ORDER_QUERIES,
    },
    invoices: {
      tool: "get_client_invoices",
      title: "Счета клиента в 1С",
      queries: ONEC_CLIENT_INVOICE_QUERIES,
    },
    debt: {
      tool: "get_client_debt",
      title: "Задолженность клиента в 1С",
      queries: ONEC_CLIENT_DEBT_QUERIES,
    },
  };
  const descriptor = descriptors[action];
  if (!descriptor) throw new UserInputError("Неизвестный вид проверки клиента 1С.");
  return descriptor;
}

async function getCrmClientForOneC(env: Env, clientId: number): Promise<Record<string, string> | null> {
  const client = await env.DB.prepare(`
    SELECT
      id,
      display_name,
      normalized_name,
      onec_counterparty_ref,
      onec_counterparty_name,
      onec_counterparty_full_name,
      onec_counterparty_bin,
      onec_counterparty_partner,
      onec_counterparty_linked_at
    FROM crm_clients
    WHERE id = ?
  `).bind(clientId).first();
  return client as Record<string, string> | null;
}

function oneCClientSearchText(client: Record<string, string>): string {
  return normalizeOptionalText(
    client.onec_counterparty_name ||
      client.onec_counterparty_full_name ||
      client.display_name ||
      client.onec_counterparty_bin,
  );
}

async function executeFirstSuccessfulOneCQuery(
  env: Env,
  candidates: Array<{ key: string; query: string }>,
  parameters: Record<string, string>,
) {
  const errors: Array<{ query_key: string; detail: string }> = [];
  for (const candidate of candidates) {
    try {
      const raw = await executeOneCMcpTool(env, "execute_query", {
        query: candidate.query,
        parameters,
      });
      return {
        queryKey: candidate.key,
        text: oneCMcpResultText(raw),
        raw,
        errors,
      };
    } catch (error) {
      errors.push({
        query_key: candidate.key,
        detail: safeOneCErrorMessage(error),
      });
    }
  }

  return {
    queryKey: "",
    text: [
      "Не удалось получить данные из 1С по этому разделу.",
      "Возможная причина: в вашей конфигурации 1С отличаются имена документов, регистров или реквизитов.",
      "Ошибки попыток:",
      ...errors.map((item) => `- ${item.query_key}: ${item.detail}`),
    ].join("\n"),
    raw: null,
    errors,
  };
}

async function appendOneCAnalysisContext(env: Env, metadata: Metadata, originalText: string): Promise<string> {
  const oneCContext = await buildOneCAnalysisContext(env, metadata, originalText);
  return appendTextBlock(originalText, oneCContext);
}

async function buildOneCAnalysisContext(env: Env, metadata: Metadata, sourceText: string): Promise<string> {
  try {
    const health = await checkOneCMcpBridge(env);
    const sections = [
      "Автоматическая проверка 1С:",
      "Используйте эти данные как справочные данные из 1С. Если данных нет, не придумывайте цену, остаток, договор или товар.",
    ];

    if (!health.reachable) {
      sections.push(`Статус 1С: не проверено (${safeOneCErrorMessage(health.detail || health.status)}).`);
      return sections.join("\n");
    }

    sections.push(`Статус 1С: bridge доступен, инструментов: ${Number(health.tools_count || 0)}.`);

    const clientSearch = detectOneCClientSearch(metadata, sourceText);
    if (clientSearch) {
      const linkedClient = await findLinkedOneCCounterparty(env, clientSearch);
      if (linkedClient) {
        sections.push([
          "Привязанный клиент 1С:",
          `CRM: ${linkedClient.display_name || clientSearch}`,
          `Контрагент 1С: ${linkedClient.onec_counterparty_name || linkedClient.onec_counterparty_full_name || "не указано"}`,
          linkedClient.onec_counterparty_full_name ? `Полное наименование: ${linkedClient.onec_counterparty_full_name}` : "",
          linkedClient.onec_counterparty_bin ? `БИН/ИНН: ${linkedClient.onec_counterparty_bin}` : "",
          linkedClient.onec_counterparty_ref ? `Ссылка/идентификатор 1С: ${linkedClient.onec_counterparty_ref}` : "",
          linkedClient.onec_counterparty_partner ? `Партнер: ${linkedClient.onec_counterparty_partner}` : "",
        ].filter(Boolean).join("\n"));
      }

      const clientResult = await executeOneCMcpTool(env, "execute_query", {
        query: ONEC_CLIENT_SEARCH_QUERY,
        parameters: oneCClientSearchParameters(clientSearch),
        limit: 10,
      });
      sections.push(`Клиент, поиск "${clientSearch}":\n${limitText(oneCMcpResultText(clientResult), 4000)}`);
    } else {
      sections.push("Клиент: поисковый признак не определен.");
    }

    const productSearch = detectOneCProductSearch(sourceText);
    if (productSearch) {
      const [productResult, stockResult, priceResult] = await Promise.all([
        executeOneCMcpTool(env, "execute_query", {
          query: ONEC_ITEM_SEARCH_QUERY,
          parameters: { Поиск: oneCSearchPattern(productSearch) },
          limit: 10,
        }),
        executeOneCMcpTool(env, "execute_query", {
          query: ONEC_STOCK_SEARCH_QUERY,
          parameters: { Поиск: oneCSearchPattern(productSearch) },
          limit: 20,
        }),
        executeOneCMcpTool(env, "execute_query", {
          query: ONEC_PRICE_SEARCH_QUERY,
          parameters: { Поиск: oneCSearchPattern(productSearch) },
          limit: 20,
        }),
      ]);
      sections.push(`Товар, поиск "${productSearch}":\n${limitText(oneCMcpResultText(productResult), 4000)}`);
      sections.push(`Остатки по "${productSearch}":\n${limitText(oneCMcpResultText(stockResult), 4000)}`);
      sections.push(`Цены по "${productSearch}":\n${limitText(oneCMcpResultText(priceResult), 4000)}`);
    } else {
      sections.push("Товар: код, артикул или достаточно точное наименование для поиска автоматически не определены.");
    }

    return sections.join("\n\n");
  } catch (error) {
    return [
      "Автоматическая проверка 1С:",
      `1С не проверена: ${safeOneCErrorMessage(error)}.`,
      "Не придумывайте цену, остаток, договор или товар, если их нет в заявке или документах.",
    ].join("\n");
  }
}

async function checkEmailBridge(env: Env) {
  const baseUrl = (env.EMAIL_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
      status: "not_configured",
      detail: "EMAIL_BRIDGE_URL не задан.",
    };
  }

  let serviceOrigin = baseUrl;
  try {
    serviceOrigin = new URL(baseUrl).origin;
  } catch {
    return {
      configured: true,
      reachable: false,
      status: "invalid_url",
      detail: "EMAIL_BRIDGE_URL задан в неверном формате.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = new Headers();
    if (env.EMAIL_BRIDGE_TOKEN) headers.set("X-Email-Bridge-Token", env.EMAIL_BRIDGE_TOKEN);

    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        configured: true,
        reachable: false,
        status: "error",
        service_origin: serviceOrigin,
        detail: data?.detail || raw || response.statusText,
      };
    }

    return {
      configured: true,
      reachable: true,
      status: data?.status || "ok",
      service: data?.service || "email-bridge",
      service_origin: serviceOrigin,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email bridge недоступен.";
    return {
      configured: true,
      reachable: false,
      status: "unreachable",
      service_origin: serviceOrigin,
      detail: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendEmailReply(request: Request, env: Env, currentUser: CurrentUser) {
  const payload = (await request.json()) as {
    request_id?: number;
    to?: string;
    subject?: string;
    body?: string;
  };
  const to = normalizeOptionalText(payload.to);
  const subject = normalizeOptionalText(payload.subject);
  const body = normalizeOptionalText(payload.body);
  const requestId = Number(payload.request_id || 0);

  if (!to || !to.includes("@")) throw new Error("Укажите email получателя.");
  if (!subject) throw new Error("Тема письма пустая.");
  if (!body) throw new Error("Текст письма пустой.");

  const baseUrl = (env.EMAIL_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("EMAIL_BRIDGE_URL не задан. Для SMTP-отправки запустите email-bridge и укажите его URL в настройках Worker.");
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.EMAIL_BRIDGE_TOKEN) headers.set("X-Email-Bridge-Token", env.EMAIL_BRIDGE_TOKEN);

  const response = await fetch(`${baseUrl}/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({ to, subject, body }),
  });
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(`Ошибка email-bridge: ${data?.detail || raw || response.statusText}`);
  }

  if (requestId) {
    const existing = await getRequest(env, requestId);
    if (existing) {
      await createRequestEvent(env, requestId, "email.sent", currentUser.display_name || currentUser.username, {
        to,
        subject,
        bridge_status: data?.status || "sent",
      });
    }
  }

  return {
    sent: true,
    to,
    subject,
    detail: data?.detail || "Письмо отправлено через email-bridge.",
  };
}

function checkWhatsAppCloudApi(env: Env) {
  const phoneNumberId = normalizeOptionalText(env.WHATSAPP_PHONE_NUMBER_ID);
  const hasToken = Boolean(normalizeOptionalText(env.WHATSAPP_ACCESS_TOKEN));
  return {
    configured: Boolean(phoneNumberId && hasToken),
    status: phoneNumberId && hasToken ? "configured" : "missing",
    phone_number_id: phoneNumberId ? maskIdentifier(phoneNumberId) : null,
    api_version: normalizeWhatsAppApiVersion(env.WHATSAPP_API_VERSION),
    detail: phoneNumberId && hasToken
      ? "Meta WhatsApp Cloud API настроен для отправки утвержденных шаблонов."
      : "Для WhatsApp нужны secrets WHATSAPP_ACCESS_TOKEN и WHATSAPP_PHONE_NUMBER_ID.",
  };
}

async function sendWhatsAppTemplateMessage(request: Request, env: Env, currentUser: CurrentUser) {
  const payload = (await request.json()) as {
    request_id?: number;
    to?: unknown;
    template_key?: unknown;
    body_parameters?: unknown;
  };
  const requestId = Number(payload.request_id || 0);
  const toPhone = normalizeWhatsAppPhone(payload.to);
  const templateKey = normalizeOptionalText(payload.template_key);
  const bodyParameters = normalizeWhatsAppBodyParameters(payload.body_parameters);

  if (!toPhone) throw new Error("Укажите номер WhatsApp в международном формате, например 77001234567.");
  if (!templateKey) throw new Error("Выберите утвержденный Meta шаблон.");

  const phoneNumberId = normalizeOptionalText(env.WHATSAPP_PHONE_NUMBER_ID);
  const accessToken = normalizeOptionalText(env.WHATSAPP_ACCESS_TOKEN);
  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp Cloud API не настроен. Добавьте WHATSAPP_ACCESS_TOKEN и WHATSAPP_PHONE_NUMBER_ID в secrets Worker.");
  }

  await ensureDefaultWhatsAppTemplates(env);
  const template = await env.DB.prepare(`
    SELECT *
    FROM whatsapp_templates
    WHERE template_key = ? AND is_enabled = 1
  `).bind(templateKey).first() as Record<string, any> | null;
  if (!template) throw new Error("Шаблон не найден или отключен.");

  const templateName = normalizeWhatsAppTemplateName(template.template_name);
  const languageCode = normalizeWhatsAppLanguageCode(template.language_code);
  const apiVersion = normalizeWhatsAppApiVersion(env.WHATSAPP_API_VERSION);
  const actor = currentUser.display_name || currentUser.username || "manager";
  const metaPayload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParameters.length ? {
        components: [
          {
            type: "body",
            parameters: bodyParameters.map((text) => ({ type: "text", text })),
          },
        ],
      } : {}),
    },
  };

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metaPayload),
  });
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  const metaMessageId = normalizeOptionalText(data?.messages?.[0]?.id);
  const errorDetail = response.ok ? "" : normalizeMetaError(data, raw, response.statusText);
  await env.DB.prepare(`
    INSERT INTO whatsapp_template_messages (
      request_id, to_phone, template_key, template_name, language_code, parameters_json, meta_message_id, status, error_detail, sent_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    requestId || null,
    toPhone,
    templateKey,
    templateName,
    languageCode,
    JSON.stringify(bodyParameters),
    metaMessageId || null,
    response.ok ? "sent" : "failed",
    errorDetail || null,
    actor,
  ).run();

  if (requestId) {
    const existing = await getRequest(env, requestId);
    if (existing) {
      await createRequestEvent(env, requestId, response.ok ? "whatsapp.template_sent" : "whatsapp.template_failed", actor, {
        to_phone: toPhone,
        template_key: templateKey,
        template_name: templateName,
        language_code: languageCode,
        meta_message_id: metaMessageId || null,
        error_detail: errorDetail || null,
      });
    }
  }

  if (!response.ok) {
    throw new Error(`Ошибка Meta WhatsApp Cloud API: ${errorDetail}`);
  }

  return {
    sent: true,
    to_phone: toPhone,
    template_key: templateKey,
    template_name: templateName,
    language_code: languageCode,
    meta_message_id: metaMessageId || null,
    detail: "Шаблон WhatsApp отправлен через Meta Cloud API.",
  };
}

async function buildSystemPrompt(env: Env): Promise<string> {
  try {
    await ensureDefaultAiRules(env);
    const result = await env.DB.prepare(`
      SELECT title, rule_text
      FROM ai_rules
      WHERE is_enabled = 1
      ORDER BY sort_order ASC, id ASC
    `).all();
    const rules = result.results
      .map((rule: any, index: number) => {
        const title = normalizeOptionalText(rule.title);
        const text = normalizeOptionalText(rule.rule_text);
        if (!text) return "";
        return `${index + 1}. ${title ? `${title}: ` : ""}${text}`;
      })
      .filter(Boolean)
      .join("\n");

    if (!rules) return SYSTEM_PROMPT;
    return `${SYSTEM_PROMPT}\n\nАктивные правила ИИ и 1С из настроек программы:\n${rules}\n`;
  } catch (error) {
    console.error("AI rules prompt fallback", error);
    return SYSTEM_PROMPT;
  }
}

async function analyzeText(env: Env, originalText: string): Promise<string> {
  const systemPrompt = await buildSystemPrompt(env);
  if (useGemini(env)) {
    return analyzeTextGemini(env, originalText, systemPrompt);
  }
  requireOpenAI(env);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: systemPrompt,
      input: `Проанализируй входящую заявку менеджера по продажам.\n\nЗаявка:\n${originalText}`,
    }),
  });
  return readOpenAIText(response);
}

async function analyzeImage(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  const systemPrompt = await buildSystemPrompt(env);
  if (useGemini(env)) {
    return analyzeImageGemini(env, filePayload, fileName, managerNote, systemPrompt);
  }
  requireOpenAI(env);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Проанализируй изображение как входящую заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
            },
            { type: "input_image", image_url: filePayload.dataUrl },
          ],
        },
      ],
    }),
  });
  return readOpenAIText(response);
}

async function analyzeDocumentImages(
  env: Env,
  pages: ParsedImagePage[],
  fileName: string,
  managerNote: string,
): Promise<string> {
  const systemPrompt = await buildSystemPrompt(env);
  if (useGemini(env)) {
    return analyzeDocumentImagesGemini(env, pages, fileName, managerNote, systemPrompt);
  }

  requireOpenAI(env);
  const content: Array<Record<string, string>> = [
    {
      type: "input_text",
      text: `Проанализируй страницы документа как входящую B2B-заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
    },
  ];
  for (const page of pages) {
    content.push({ type: "input_text", text: `Страница ${page.pageNumber}` });
    content.push({ type: "input_image", image_url: page.payload.dataUrl });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: systemPrompt,
      input: [{ role: "user", content }],
    }),
  });
  return readOpenAIText(response);
}

async function transcribeAudio(env: Env, file: File, managerNote: string): Promise<string> {
  if (useGemini(env)) {
    const filePayload = await fileToPayload(file);
    return transcribeAudioGemini(env, filePayload, file.name, managerNote);
  }
  requireOpenAI(env);
  const formData = new FormData();
  formData.append("model", env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe");
  formData.append("file", file, file.name);
  formData.append("response_format", "text");
  formData.append("prompt", `Голосовое сообщение из WhatsApp/Telegram по B2B-продажам электротехники. Контекст: ${managerNote || "нет"}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formData,
  });
  if (!response.ok) throw new Error(`Ошибка OpenAI transcription: ${await response.text()}`);
  return (await response.text()).trim();
}

async function analyzeTextGemini(env: Env, originalText: string, systemPrompt: string): Promise<string> {
  requireGemini(env);
  const response = await fetchGeminiGenerateContent(env, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        parts: [
          {
            text: `Проанализируй входящую заявку менеджера по продажам.\n\nЗаявка:\n${originalText}`,
          },
        ],
      },
    ],
  });
  return readGeminiText(response);
}

async function analyzeImageGemini(
  env: Env,
  filePayload: FilePayload,
  fileName: string,
  managerNote: string,
  systemPrompt: string,
): Promise<string> {
  requireGemini(env);
  const response = await fetchGeminiGenerateContent(env, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        parts: [
          {
            text: `Проанализируй изображение как входящую заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
          },
          {
            inline_data: {
              mime_type: filePayload.mimeType,
              data: filePayload.base64,
            },
          },
        ],
      },
    ],
  });
  return readGeminiText(response);
}

async function analyzePdfGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  if (filePayload.base64.length > 28_000_000) {
    throw new Error("PDF слишком большой для прямой обработки через Gemini. Настройте parser-service или загрузите файл меньше 20 МБ.");
  }
  const systemPrompt = await buildSystemPrompt(env);

  const response = await fetchGeminiInteractions(env, {
    input: [
      {
        type: "text",
        text: `${systemPrompt}\n\nПроанализируй PDF-документ как входящую B2B-заявку или счет. Если это счет на оплату, точно извлеки все строки товара: код, наименование, единицу измерения, количество, цену с НДС 16%, сумму с НДС 16% и гарантию. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
      },
      {
        type: "document",
        data: filePayload.base64,
        mime_type: "application/pdf",
      },
    ],
  });
  return readGeminiInteractionText(response);
}

async function analyzeDocumentImagesGemini(
  env: Env,
  pages: ParsedImagePage[],
  fileName: string,
  managerNote: string,
  systemPrompt: string,
): Promise<string> {
  requireGemini(env);
  const parts: Array<Record<string, unknown>> = [
    {
      text: `Проанализируй страницы документа как входящую B2B-заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
    },
  ];
  for (const page of pages) {
    parts.push({ text: `Страница ${page.pageNumber}` });
    parts.push({
      inline_data: {
        mime_type: page.payload.mimeType,
        data: page.payload.base64,
      },
    });
  }

  const response = await fetchGeminiGenerateContent(env, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts }],
  });
  return readGeminiText(response);
}

async function transcribeAudioGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  const response = await fetchGeminiGenerateContent(
    env,
    {
      contents: [
        {
          parts: [
            {
              text: `Расшифруй голосовое сообщение дословно на языке оригинала. Это B2B-заявка по электротехнике. Имя файла: ${fileName}. Контекст: ${managerNote || "нет"}`,
            },
            {
              inline_data: {
                mime_type: filePayload.mimeType,
                data: filePayload.base64,
              },
            },
          ],
        },
      ],
    },
    env.GEMINI_TRANSCRIBE_MODEL,
  );
  return readGeminiText(response);
}

async function readOpenAIText(response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(`Ошибка OpenAI API: ${raw}`);
  const data = JSON.parse(raw);
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const text = data.output?.flatMap((item: any) => item.content || [])
    ?.map((content: any) => content.text || "")
    ?.join("\n")
    ?.trim();
  if (!text) throw new Error("OpenAI API вернул пустой ответ.");
  return text;
}

async function readGeminiText(response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(formatGeminiError("Gemini API", response.status, raw));
  const data = JSON.parse(raw);
  const text = data.candidates?.flatMap((candidate: any) => candidate.content?.parts || [])
    ?.map((part: any) => part.text || "")
    ?.join("\n")
    ?.trim();
  if (!text) throw new Error("Gemini API вернул пустой ответ.");
  return text;
}

async function readGeminiInteractionText(response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(formatGeminiError("Gemini Interactions API", response.status, raw));
  const data = JSON.parse(raw);
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (typeof data.outputText === "string" && data.outputText.trim()) return data.outputText.trim();

  const lastStep = Array.isArray(data.steps) ? data.steps[data.steps.length - 1] : null;
  const stepText = Array.isArray(lastStep?.content)
    ? lastStep.content.map((part: any) => part?.text || "").join("\n").trim()
    : "";
  if (stepText) return stepText;

  const outputText = Array.isArray(data.outputs)
    ? data.outputs.map((part: any) => part?.text || "").join("\n").trim()
    : "";
  if (outputText) return outputText;

  throw new Error("Gemini Interactions API вернул пустой ответ.");
}

async function listRequests(env: Env) {
  const result = await env.DB.prepare(`
    SELECT
      r.*,
      c.onec_counterparty_ref,
      c.onec_counterparty_name,
      c.onec_counterparty_full_name,
      c.onec_counterparty_bin,
      c.onec_counterparty_partner,
      c.onec_counterparty_linked_at,
      COALESCE(task_counts.open_task_count, 0) AS open_task_count,
      COALESCE(task_counts.done_task_count, 0) AS done_task_count,
      COALESCE(task_counts.total_task_count, 0) AS total_task_count
    FROM requests r
    LEFT JOIN crm_clients c ON c.id = r.client_id
    LEFT JOIN (
      SELECT
        request_id,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_task_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_task_count,
        COUNT(*) AS total_task_count
      FROM request_tasks
      GROUP BY request_id
    ) task_counts ON task_counts.request_id = r.id
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all();
  return result.results;
}

async function listEmailMessages(env: Env, user: CurrentUser, folderParam: string | null) {
  const folder = normalizeEmailFolder(folderParam) || "inbox";
  const scope = emailMailboxScope(user);
  const result = await env.DB.prepare(`
    SELECT
      *,
      EXISTS (
        SELECT 1
        FROM email_sender_filters sender_filters
        WHERE sender_filters.is_hidden = 1
          AND sender_filters.sender_email = lower(trim(email_messages.from_address))
      ) AS is_sender_hidden,
      substr(body_text, 1, 420) AS body_preview
    FROM email_messages
    WHERE folder = ?
      ${scope.sql}
      AND NOT EXISTS (
        SELECT 1
        FROM email_sender_filters sender_filters
        WHERE sender_filters.is_hidden = 1
          AND sender_filters.sender_email = lower(trim(email_messages.from_address))
      )
    ORDER BY COALESCE(received_at, created_at) DESC, id DESC
    LIMIT 100
  `).bind(folder, ...scope.bindings).all();
  return {
    folder,
    items: result.results,
    stats: await getEmailFolderStats(env, user),
    hidden_senders: await listEmailSenderFilters(env),
  };
}

async function countEmailMessages(env: Env, user: CurrentUser): Promise<number> {
  const scope = emailMailboxScope(user);
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM email_messages
    WHERE 1 = 1
      ${scope.sql}
  `).bind(...scope.bindings).first() as Record<string, unknown> | null;
  return Number(row?.count || 0);
}

async function getEmailFolderStats(env: Env, user: CurrentUser) {
  const scope = emailMailboxScope(user);
  const result = await env.DB.prepare(`
    SELECT
      folder,
      COUNT(*) AS total,
      SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
    FROM email_messages
    WHERE 1 = 1
      ${scope.sql}
      AND NOT EXISTS (
      SELECT 1
      FROM email_sender_filters sender_filters
      WHERE sender_filters.is_hidden = 1
        AND sender_filters.sender_email = lower(trim(email_messages.from_address))
    )
    GROUP BY folder
  `).bind(...scope.bindings).all();
  const stats: Record<EmailFolder, { total: number; unread: number }> = {
    inbox: { total: 0, unread: 0 },
    in_work: { total: 0, unread: 0 },
    suppliers: { total: 0, unread: 0 },
    buyers: { total: 0, unread: 0 },
    done: { total: 0, unread: 0 },
    trash: { total: 0, unread: 0 },
  };
  for (const row of result.results || []) {
    const folder = normalizeEmailFolder(String((row as Record<string, unknown>).folder || ""));
    if (!folder) continue;
    stats[folder] = {
      total: Number((row as Record<string, unknown>).total || 0),
      unread: Number((row as Record<string, unknown>).unread || 0),
    };
  }
  return stats;
}

async function listEmailSenderFilters(env: Env) {
  const result = await env.DB.prepare(`
    SELECT id, sender_email, sender_label, is_hidden, created_at, updated_at
    FROM email_sender_filters
    WHERE is_hidden = 1
    ORDER BY sender_email
  `).all();
  return result.results;
}

async function createEmailSenderFilter(request: Request, env: Env) {
  const payload = (await request.json()) as {
    sender_email?: unknown;
    sender_label?: unknown;
  };
  const senderEmail = normalizeEmailFilterAddress(payload.sender_email);
  if (!senderEmail) throw new Error("Не удалось определить адрес отправителя.");
  const senderLabel = normalizeOptionalText(payload.sender_label) || senderEmail;

  await env.DB.prepare(`
    INSERT INTO email_sender_filters (sender_email, sender_label, is_hidden, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(sender_email) DO UPDATE SET
      sender_label = excluded.sender_label,
      is_hidden = 1,
      updated_at = datetime('now')
  `).bind(senderEmail, senderLabel).run();

  const item = await env.DB.prepare(`
    SELECT id, sender_email, sender_label, is_hidden, created_at, updated_at
    FROM email_sender_filters
    WHERE sender_email = ?
  `).bind(senderEmail).first();
  return item;
}

async function deleteEmailSenderFilter(env: Env, id: number) {
  const existing = await env.DB.prepare(`
    SELECT id, sender_email, sender_label
    FROM email_sender_filters
    WHERE id = ?
  `).bind(id).first() as Record<string, unknown> | null;
  if (!existing) return { ok: true, id };

  await env.DB.prepare("DELETE FROM email_sender_filters WHERE id = ?").bind(id).run();
  return { ok: true, id, sender_email: existing.sender_email };
}

async function getEmailSenderFolderRule(env: Env, sender: unknown): Promise<EmailFolder | ""> {
  const senderEmail = normalizeEmailFilterAddress(sender);
  if (!senderEmail) return "";

  const row = await env.DB.prepare(`
    SELECT target_folder
    FROM email_sender_folder_rules
    WHERE sender_email = ?
  `).bind(senderEmail).first() as Record<string, unknown> | null;

  return normalizeEmailSenderRouteFolder(row?.target_folder);
}

async function upsertEmailSenderFolderRule(env: Env, sender: unknown, targetFolder: EmailFolder) {
  const folder = normalizeEmailSenderRouteFolder(targetFolder);
  const senderEmail = normalizeEmailFilterAddress(sender);
  if (!folder || !senderEmail) return;

  await env.DB.prepare(`
    INSERT INTO email_sender_folder_rules (sender_email, sender_label, target_folder, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(sender_email) DO UPDATE SET
      sender_label = excluded.sender_label,
      target_folder = excluded.target_folder,
      updated_at = datetime('now')
  `).bind(senderEmail, senderEmail, folder).run();

  await env.DB.prepare(`
    UPDATE email_messages
    SET
      folder = ?,
      status = ?,
      closed_at = NULL,
      updated_at = datetime('now')
    WHERE folder <> 'trash'
      AND processed_request_id IS NULL
      AND (
        lower(trim(from_address)) = ?
        OR lower(trim(from_address)) LIKE ?
      )
  `).bind(folder, emailStatusForFolder(folder), senderEmail, `%${senderEmail}%`).run();
}

async function getUserByMailboxEmail(env: Env, mailboxEmail: unknown) {
  const emailAddress = normalizeCompanyMailboxAddress(mailboxEmail);
  if (!emailAddress) return null;

  return env.DB.prepare(`
    SELECT id, username, display_name, email_address
    FROM app_users
    WHERE email_address = ?
      AND is_active = 1
  `).bind(emailAddress).first() as Promise<Record<string, any> | null>;
}

async function assignExistingEmailsToUser(env: Env, emailAddress: string, managerName: string) {
  await env.DB.prepare(`
    UPDATE email_messages
    SET
      michael_manager = ?,
      updated_at = datetime('now')
    WHERE (
        lower(trim(mailbox_email)) = ?
        OR lower(trim(to_address)) = ?
      )
  `).bind(managerName, emailAddress, emailAddress).run();
}

async function getEmailMessage(env: Env, id: number) {
  return env.DB.prepare(`
    SELECT
      *,
      EXISTS (
        SELECT 1
        FROM email_sender_filters sender_filters
        WHERE sender_filters.is_hidden = 1
          AND sender_filters.sender_email = lower(trim(email_messages.from_address))
      ) AS is_sender_hidden
    FROM email_messages
    WHERE id = ?
  `).bind(id).first() as Promise<Record<string, any> | null>;
}

async function updateEmailMessage(request: Request, env: Env, id: number) {
  const existing = await getEmailMessage(env, id);
  if (!existing) return null;

  const payload = (await request.json()) as {
    folder?: unknown;
    status?: unknown;
    is_read?: unknown;
  };

  const requestedFolder = normalizeEmailFolder(typeof payload.folder === "string" ? payload.folder : "");
  const requestedStatus = normalizeEmailStatus(typeof payload.status === "string" ? payload.status : "");
  let folder = requestedFolder || normalizeEmailFolder(String(existing.folder || "")) || "inbox";
  let status = requestedStatus || normalizeEmailStatus(String(existing.status || "")) || emailStatusForFolder(folder);

  if (requestedFolder && !requestedStatus) status = emailStatusForFolder(requestedFolder);
  if (requestedStatus && !requestedFolder) folder = emailFolderForStatus(requestedStatus);

  const isRead = typeof payload.is_read === "boolean" ? (payload.is_read ? 1 : 0) : Number(existing.is_read || 0);
  await env.DB.prepare(`
    UPDATE email_messages
    SET
      folder = ?,
      status = ?,
      is_read = ?,
      read_at = CASE
        WHEN ? = 1 AND read_at IS NULL THEN datetime('now')
        WHEN ? = 0 THEN NULL
        ELSE read_at
      END,
      closed_at = CASE
        WHEN ? = 'done' AND closed_at IS NULL THEN datetime('now')
        WHEN ? <> 'done' THEN NULL
        ELSE closed_at
      END,
      deleted_at = CASE
        WHEN ? = 'trash' AND deleted_at IS NULL THEN datetime('now')
        WHEN ? <> 'trash' THEN NULL
        ELSE deleted_at
      END,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    folder,
    status,
    isRead,
    isRead,
    isRead,
    folder,
    folder,
    folder,
    folder,
    id,
  ).run();

  if (requestedFolder && isEmailSenderRouteFolder(requestedFolder) && existing.from_address) {
    await upsertEmailSenderFolderRule(env, existing.from_address, requestedFolder);
  }

  return getEmailMessage(env, id);
}

async function moveEmailMessageToTrash(env: Env, id: number) {
  const existing = await getEmailMessage(env, id);
  if (!existing) return null;

  await env.DB.prepare(`
    UPDATE email_messages
    SET
      folder = 'trash',
      status = 'deleted',
      is_read = 1,
      read_at = COALESCE(read_at, datetime('now')),
      deleted_at = COALESCE(deleted_at, datetime('now')),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(id).run();

  return getEmailMessage(env, id);
}

async function getEmailMessageByUid(env: Env, mailboxEmail: string | null, messageUid: string) {
  return env.DB.prepare("SELECT * FROM email_messages WHERE mailbox_email IS ? AND message_uid = ?")
    .bind(mailboxEmail, messageUid)
    .first() as Promise<Record<string, any> | null>;
}

async function storeRoutedEmail(env: Env, message: ForwardableEmailMessage) {
  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(rawBuffer) as Record<string, any>;
  const rawHash = await sha256Base64UrlBytes(rawBuffer);

  const messageId = normalizeOptionalText(parsed.messageId || message.headers.get("message-id"));
  const messageUid = messageId || rawHash;
  const fromAddress = normalizeEmailAddress(parsed.from?.address) || normalizeOptionalText(message.from);
  const toAddress = normalizeEmailAddress(parsed.to?.[0]?.address) || normalizeOptionalText(message.to);
  const subject = normalizeOptionalText(parsed.subject || message.headers.get("subject")) || "Без темы";
  const bodyText = normalizeOptionalText(parsed.text) || htmlToText(normalizeOptionalText(parsed.html));
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  const attachmentNames = attachments
    .map((attachment: any, index: number) => normalizeOptionalText(attachment.filename) || `attachment-${index + 1}`)
    .filter(Boolean)
    .join("; ");
  const receivedAt = normalizeEmailDate(parsed.date || message.headers.get("date"));

  await storeEmailMessage(env, {
    mailbox_name: "Cloudflare Email Routing",
    mailbox_email: normalizeOptionalText(message.to) || toAddress || null,
    michael_manager: null,
    message_uid: messageUid,
    from_address: fromAddress || null,
    to_address: toAddress || null,
    subject,
    body_text: bodyText || "(письмо без текстового содержимого)",
    attachment_names: attachmentNames || null,
    attachment_text: null,
    received_at: receivedAt || null,
  });
}

async function ingestEmailMessage(request: Request, env: Env): Promise<Response> {
  const configuredToken = normalizeOptionalText(env.EMAIL_INGEST_TOKEN);
  if (!configuredToken) {
    return json({ detail: "EMAIL_INGEST_TOKEN не настроен в Worker." }, 503);
  }

  const incomingToken = extractIngestToken(request);
  if (!incomingToken || !(await timingSafeStringEqual(incomingToken, configuredToken))) {
    return json({ detail: "Неверный ingest token." }, 401);
  }

  let payload: EmailIngestPayload;
  try {
    payload = (await request.json()) as EmailIngestPayload;
  } catch {
    return json({ detail: "Передайте JSON с данными письма." }, 400);
  }

  const mailboxEmail = normalizeOptionalText(payload.mailbox_email);
  const messageUid = normalizeOptionalText(payload.message_uid);
  if (!mailboxEmail) return json({ detail: "mailbox_email обязателен." }, 400);
  if (!messageUid) return json({ detail: "message_uid обязателен." }, 400);

  const item: EmailMessageInput = {
    mailbox_name: normalizeOptionalText(payload.mailbox_name) || "IMAP mailcow",
    mailbox_email: mailboxEmail,
    michael_manager: normalizeOptionalText(payload.michael_manager) || null,
    message_uid: messageUid,
    from_address: normalizeOptionalText(payload.from_address) || null,
    to_address: normalizeOptionalText(payload.to_address) || null,
    subject: normalizeOptionalText(payload.subject) || "Без темы",
    body_text: normalizeOptionalText(payload.body_text) || "(письмо без текстового содержимого)",
    attachment_names: normalizeAttachmentNames(payload.attachment_names),
    attachment_text: normalizeOptionalText(payload.attachment_text) || null,
    received_at: normalizeEmailDate(payload.received_at) || null,
  };

  const stored = await storeEmailMessage(env, item);
  return json({
    ok: true,
    inserted: stored.inserted,
    id: stored.id,
    mailbox_email: item.mailbox_email,
    message_uid: item.message_uid,
  });
}

async function storeEmailMessage(env: Env, item: EmailMessageInput): Promise<{ inserted: boolean; id: number | null }> {
  const existing = await getEmailMessageByUid(env, item.mailbox_email, item.message_uid);
  if (existing?.id) return { inserted: false, id: Number(existing.id) };

  const routedFolder = await getEmailSenderFolderRule(env, item.from_address);
  const folder = routedFolder || "inbox";
  const mailboxUser = await getUserByMailboxEmail(env, item.mailbox_email || item.to_address);
  const assignedManager = item.michael_manager
    || normalizeOptionalText(mailboxUser?.display_name)
    || normalizeOptionalText(mailboxUser?.username)
    || null;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO email_messages (
      mailbox_name,
      mailbox_email,
      michael_manager,
      message_uid,
      from_address,
      to_address,
      subject,
      body_text,
      attachment_names,
      attachment_text,
      folder,
      status,
      received_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    item.mailbox_name,
    item.mailbox_email,
    assignedManager,
    item.message_uid,
    item.from_address,
    item.to_address,
    item.subject,
    item.body_text,
    item.attachment_names,
    item.attachment_text,
    folder,
    emailStatusForFolder(folder),
    item.received_at,
  ).run();

  const saved = await getEmailMessageByUid(env, item.mailbox_email, item.message_uid);
  return { inserted: Boolean(saved?.id), id: saved?.id ? Number(saved.id) : null };
}

async function processEmailMessage(env: Env, emailId: number) {
  const emailItem = await getEmailMessage(env, emailId);
  if (!emailItem) return null;

  if (emailItem.processed_request_id) {
    const existing = await getRequest(env, Number(emailItem.processed_request_id));
    if (existing) return existing;
  }

  const emailText = buildEmailAnalysisText(emailItem);
  const clientCompany = detectKbiEnergy(emailText) ? "ТОО KBI Energy" : "";
  const metadata: Metadata = {
    client_company: clientCompany,
    client_contact_name: normalizeOptionalText(emailItem.from_address),
    michael_manager: normalizeOptionalText(emailItem.michael_manager),
    communication_channel: "Email",
    priority: clientCompany ? "high" : "normal",
    next_action: "Подготовить ответ клиенту",
  };
  let originalText = `${buildContextPrefix(metadata)}${emailText}`;
  originalText = await appendOneCAnalysisContext(env, metadata, originalText);
  const aiResult = await analyzeText(env, originalText);

  const item = await insertRequest(env, {
    source_type: "email",
    ...metadata,
    original_text: originalText,
    uploaded_file_name: emailItem.attachment_names || null,
    ai_result: aiResult,
  }) as Record<string, any> | null;

  if (!item?.id) throw new Error("Не удалось создать заявку из письма.");

  await env.DB.prepare(`
    UPDATE email_messages
    SET
      processed_request_id = ?,
      folder = 'in_work',
      status = 'in_work',
      is_read = 1,
      read_at = COALESCE(read_at, datetime('now')),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(Number(item.id), emailId).run();

  await createRequestEvent(env, Number(item.id), "email.processed", metadata.michael_manager || "system", {
    email_id: emailId,
    from_address: emailItem.from_address || null,
    mailbox_email: emailItem.mailbox_email || null,
    subject: emailItem.subject || null,
  });

  return getRequest(env, Number(item.id));
}

function buildEmailAnalysisText(emailItem: Record<string, any>): string {
  const parts = [
    "Входящее письмо из почтового ящика Michael.",
    `От: ${emailItem.from_address || "уточняется"}`,
    `Кому: ${emailItem.to_address || "уточняется"}`,
    `Почтовый ящик Michael: ${emailItem.mailbox_email || "уточняется"}`,
    `Ответственный менеджер Michael: ${emailItem.michael_manager || "уточняется"}`,
    `Тема: ${emailItem.subject || "без темы"}`,
    `Дата письма: ${emailItem.received_at || "уточняется"}`,
    "",
    "Тело письма:",
    emailItem.body_text || "уточняется",
  ];
  if (emailItem.attachment_names) parts.push("", "Вложения:", emailItem.attachment_names);
  if (emailItem.attachment_text) parts.push("", "Текст из поддерживаемых вложений:", emailItem.attachment_text);
  return parts.join("\n");
}

function normalizeEmailAddress(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "address" in value) {
    return normalizeOptionalText((value as { address?: unknown }).address);
  }
  return "";
}

function normalizeEmailFilterAddress(value: unknown): string {
  const text = normalizeOptionalText(value).toLowerCase();
  if (!text) return "";
  const match = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return (match ? match[0] : text).trim().slice(0, 254);
}

function normalizeCompanyMailboxAddress(value: unknown): string {
  const emailAddress = normalizeEmailFilterAddress(value);
  return emailAddress.endsWith("@edel.kz") ? emailAddress : "";
}

function normalizeEdelEmailAddress(value: unknown): string {
  const raw = normalizeOptionalText(value);
  if (!raw) return "";

  const emailAddress = normalizeEmailFilterAddress(raw);
  if (!emailAddress || !emailAddress.endsWith("@edel.kz")) {
    throw new UserInputError("Email пользователя должен быть ящиком домена edel.kz.");
  }
  return emailAddress;
}

function normalizeEmailDate(value: unknown): string {
  const text = normalizeOptionalText(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function extractIngestToken(request: Request): string {
  const bearer = normalizeOptionalText(request.headers.get("authorization"));
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return normalizeOptionalText(request.headers.get("x-ingest-token"));
}

async function timingSafeStringEqual(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let diff = actualBytes.length ^ expectedBytes.length;
  for (let index = 0; index < Math.max(actualBytes.length, expectedBytes.length); index += 1) {
    diff |= (actualBytes[index] || 0) ^ (expectedBytes[index] || 0);
  }
  return diff === 0;
}

function normalizeAttachmentNames(value: unknown): string | null {
  if (Array.isArray(value)) {
    const names = value.map((item) => normalizeOptionalText(item)).filter(Boolean);
    return names.length ? names.join("; ") : null;
  }
  return normalizeOptionalText(value) || null;
}

function htmlToText(value: string): string {
  if (!value) return "";
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

async function getRequest(env: Env, id: number) {
  return env.DB.prepare(`
    SELECT
      r.*,
      c.onec_counterparty_ref,
      c.onec_counterparty_name,
      c.onec_counterparty_full_name,
      c.onec_counterparty_bin,
      c.onec_counterparty_partner,
      c.onec_counterparty_linked_at,
      COALESCE(task_counts.open_task_count, 0) AS open_task_count,
      COALESCE(task_counts.done_task_count, 0) AS done_task_count,
      COALESCE(task_counts.total_task_count, 0) AS total_task_count
    FROM requests r
    LEFT JOIN crm_clients c ON c.id = r.client_id
    LEFT JOIN (
      SELECT
        request_id,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_task_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_task_count,
        COUNT(*) AS total_task_count
      FROM request_tasks
      GROUP BY request_id
    ) task_counts ON task_counts.request_id = r.id
    WHERE r.id = ?
  `).bind(id).first();
}

async function insertRequest(env: Env, item: Record<string, any>) {
  const crm = await ensureCrmLink(env, item);
  const status = normalizeStatus(item.status);
  const priority = normalizePriority(item.priority);
  const nextAction = normalizeOptionalText(item.next_action);
  const appendixStatus = crm.requiresContractAppendix ? "required" : "not_required";

  const result = await env.DB.prepare(`
    INSERT INTO requests (
      source_type, client_company, client_contact_name, michael_manager,
      communication_channel, original_text, uploaded_file_name, ai_result,
      status, priority, client_type, requires_contract_appendix,
      next_action, client_id, contact_id, michael_manager_id,
      invoice_status, contract_appendix_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)
    .bind(
      item.source_type,
      item.client_company || null,
      item.client_contact_name || null,
      item.michael_manager || null,
      item.communication_channel || null,
      item.original_text,
      item.uploaded_file_name || null,
      item.ai_result,
      status,
      priority,
      crm.clientType,
      crm.requiresContractAppendix ? 1 : 0,
      nextAction,
      crm.clientId,
      crm.contactId,
      crm.michaelManagerId,
      "not_required",
      appendixStatus,
    )
    .run();
  const requestId = Number(result.meta.last_row_id);
  await createRequestEvent(env, requestId, "request.created", item.michael_manager || "system", {
    source_type: item.source_type,
    status,
    priority,
    client_company: item.client_company || null,
    client_contact_name: item.client_contact_name || null,
    michael_manager: item.michael_manager || null,
    communication_channel: item.communication_channel || null,
    requires_contract_appendix: crm.requiresContractAppendix,
    invoice_status: "not_required",
    contract_appendix_status: appendixStatus,
  });
  await createDefaultTasks(env, requestId, item, crm.requiresContractAppendix);
  return getRequest(env, requestId);
}

async function updateRequestStatus(request: Request, env: Env, id: number) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  const payload = (await request.json()) as {
    status?: string;
    priority?: string;
    next_action?: string;
    actor?: string;
  };
  const status = normalizeStatus(payload.status || existing.status || "new");
  const priority = normalizePriority(payload.priority || existing.priority || "normal");
  const nextAction = normalizeOptionalText(payload.next_action);
  const actor = normalizeOptionalText(payload.actor) || existing.michael_manager || "system";

  await env.DB.prepare(`
    UPDATE requests
    SET status = ?, priority = ?, next_action = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(status, priority, nextAction, id).run();

  await createRequestEvent(env, id, "request.status_updated", actor, {
    previous_status: existing.status || "new",
    status,
    priority,
    next_action: nextAction,
  });

  return getRequest(env, id);
}

async function deleteRequest(env: Env, id: number) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  await env.DB.prepare(`
    UPDATE email_messages
    SET processed_request_id = NULL
    WHERE processed_request_id = ?
  `).bind(id).run();
  await env.DB.prepare("DELETE FROM request_tasks WHERE request_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM request_events WHERE request_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM requests WHERE id = ?").bind(id).run();

  return { ok: true, request_id: id };
}

async function updateDealDocuments(request: Request, env: Env, id: number) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  const payload = (await request.json()) as {
    invoice_number?: string;
    invoice_date?: string;
    invoice_status?: string;
    contract_appendix_status?: string;
    contract_appendix_note?: string;
    customer_sent_at?: string;
    actor?: string;
  };

  const invoiceNumber = normalizeOptionalText(payload.invoice_number);
  const invoiceDate = normalizeIsoDate(payload.invoice_date);
  const invoiceStatus = normalizeInvoiceStatus(payload.invoice_status || existing.invoice_status || "not_required");
  const appendixStatus = normalizeAppendixStatus(
    payload.contract_appendix_status ||
      existing.contract_appendix_status ||
      (existing.requires_contract_appendix ? "required" : "not_required"),
  );
  const appendixNote = normalizeOptionalText(payload.contract_appendix_note);
  const customerSentAt = normalizeOptionalText(payload.customer_sent_at);
  const actor = normalizeOptionalText(payload.actor) || existing.michael_manager || "system";

  await env.DB.prepare(`
    UPDATE requests
    SET invoice_number = ?,
        invoice_date = ?,
        invoice_status = ?,
        contract_appendix_status = ?,
        contract_appendix_note = ?,
        customer_sent_at = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    invoiceNumber || null,
    invoiceDate || null,
    invoiceStatus,
    appendixStatus,
    appendixNote || null,
    customerSentAt || null,
    id,
  ).run();

  await createRequestEvent(env, id, "request.deal_documents_updated", actor, {
    invoice_number: invoiceNumber || null,
    invoice_date: invoiceDate || null,
    invoice_status: invoiceStatus,
    contract_appendix_status: appendixStatus,
    contract_appendix_note: appendixNote || null,
    customer_sent_at: customerSentAt || null,
  });

  return getRequest(env, id);
}

async function generateContractAppendix(env: Env, id: number, currentUser: CurrentUser) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  const appendix = buildContractAppendix(existing);
  const actor = currentUser.display_name || currentUser.username || existing.michael_manager || "system";
  const generatedAt = new Date().toISOString();
  const eventNote = `Приложение сформировано ${generatedAt} по заявке #${id}.`;
  const previousNote = normalizeOptionalText(existing.contract_appendix_note);
  const nextNote = previousNote ? `${previousNote}\n${eventNote}` : eventNote;

  await env.DB.prepare(`
    UPDATE requests
    SET contract_appendix_status = ?,
        contract_appendix_note = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind("prepared", nextNote, id).run();

  await createRequestEvent(env, id, "request.contract_appendix_generated", actor, {
    file_name: appendix.file_name,
    invoice_number: existing.invoice_number || null,
    invoice_date: existing.invoice_date || null,
    generated_at: generatedAt,
  });

  return {
    ...appendix,
    request: await getRequest(env, id),
  };
}

function buildContractAppendix(item: Record<string, any>) {
  const requestId = Number(item.id || 0);
  const sourceText = [
    normalizeOptionalText(item.ai_result),
    normalizeOptionalText(item.original_text),
  ].filter(Boolean).join("\n\n");
  const invoiceNumber = normalizeOptionalText(item.invoice_number) || extractInvoiceNumber(sourceText) || "уточняется";
  const invoiceDate = normalizeOptionalText(item.invoice_date) || extractInvoiceDate(sourceText) || "уточняется";
  const data = buildKbiAppendixData(item, requestId, invoiceNumber, invoiceDate);

  return {
    appendix_text: buildKbiAppendixText(data),
    appendix_html: buildAppendixHtml(data),
    file_name: buildAppendixFileName(requestId, invoiceNumber, "KBI-Energy-Group"),
  };
}

type AppendixTableRow = {
  number: number;
  code: string;
  name: string;
  unit: string;
  quantity: string;
  price: string;
  sum: string;
  warranty: string;
  sumValue: number | null;
};

type KbiAppendixData = {
  requestId: number;
  appendixDateRu: string;
  contractNumber: string;
  contractDateRu: string;
  rows: AppendixTableRow[];
  totalText: string;
  totalWords: string;
  paymentTerm: string;
  deliveryPlace: string;
};

const KBI_CONTRACT_NUMBER = "71-02-26/СН";
const KBI_CONTRACT_DATE_RU = "17 февраля 2026 года";
const KBI_DEFAULT_DELIVERY_PLACE = "DDP, г. Экибастуз.";
const KBI_DEFAULT_PAYMENT_TERM = "20 календарных дней с момента получения Товара.";
const KBI_DEFAULT_WARRANTY = "14 дней";
const KBI_BUYER_SIGNATORY = "Абдрахманов Д.Е.";
const MICHAEL_SUPPLIER_SIGNATORY = "Эйрих М.М.";

const KBI_BUYER_REQUISITES = [
  "Покупатель:",
  "ТОО «KBI Energy Group»",
  "БИН 060340017540",
  "юридический адрес:",
  "010000, Республика Казахстан,",
  "г. Астана, район Нура",
  "ул. Кайым Мухамедханова",
  "здание 5 н.п. 43",
  "фактический адрес:",
  "S15F6F4, Павлодарская область,",
  "г. Экибастуз, ул. Железнодорожная строение 28",
  "Свидетельство по НДС",
  "Серии 62001 от 1044193 от 24.07.2023г.",
  "Банковские реквизиты:",
  "АО «Народный банк Казахстана»",
  "ИИК KZ76601A361000707821 KZT",
  "БИК HSBKKZKX",
  "тел: 8 (7187) 278-543",
  "эл.почта: too_kbc@mail.ru",
];

const MICHAEL_SUPPLIER_REQUISITES = [
  "Поставщик:",
  "ТОО «Michael»",
  "БИН 170940023817",
  "Юридический и фактический адрес:",
  "141200, Республика Казахстан,",
  "Павлодарская обл., г. Экибастуз,",
  "ул. Абая, здание 60/1, офис 113",
  "Банковские реквизиты:",
  "Банк: АО \"ForteBank\"",
  "БИК IRTYKZKA",
  "ИИК KZ0396506F0007735246",
  "Свидетельство НДС Серия 45001 № 0057470 от",
  "20 сентября 2017 года.",
  "Телефоны: +7(7187) 74-08-64",
  "+77775550016",
  "Эл.почта: direktor@edel.kz",
];

function buildKbiAppendixData(
  item: Record<string, any>,
  requestId: number,
  invoiceNumber: string,
  invoiceDate: string,
): KbiAppendixData {
  const sourceText = [
    normalizeOptionalText(item.ai_result),
    normalizeOptionalText(item.original_text),
    invoiceNumber !== "уточняется" ? `Номер счета: ${invoiceNumber}` : "",
    invoiceDate !== "уточняется" ? `Дата счета: ${invoiceDate}` : "",
  ].filter(Boolean).join("\n\n");
  const rows = parseAppendixRows(sourceText);
  const appendixRows = rows;
  const totalValue = appendixRows.reduce((sum, row) => row.sumValue !== null ? sum + row.sumValue : sum, 0);
  const hasTotal = appendixRows.some((row) => row.sumValue !== null);
  const totalText = hasTotal ? formatMoney(totalValue) : "________";

  return {
    requestId,
    appendixDateRu: formatRuDate(invoiceDate) || formatRuDate(new Date().toISOString().slice(0, 10)) || "____ __________ ____ года",
    contractNumber: KBI_CONTRACT_NUMBER,
    contractDateRu: KBI_CONTRACT_DATE_RU,
    rows: appendixRows,
    totalText,
    totalWords: hasTotal ? capitalizeFirst(moneyToRussianWords(totalValue)) : "________________",
    deliveryPlace: extractDeliveryPlace(sourceText) || KBI_DEFAULT_DELIVERY_PLACE,
    paymentTerm: extractPaymentTerm(sourceText) || KBI_DEFAULT_PAYMENT_TERM,
  };
}

function extractAiSection(value: string, letter: string): string {
  if (!value) return "";
  const escapedLetter = letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedLetter}\\.\\s[\\s\\S]*?(?=^[A-F]\\.\\s|$)`, "m");
  const match = value.match(pattern);
  return match ? match[0].trim() : "";
}

function cleanAiSectionTitle(value: string): string {
  return value.replace(/^[A-F]\.\s+[^\n]+\n*/u, "").trim();
}

function parseAppendixRows(sourceText: string): AppendixTableRow[] {
  const numberedRows = parseNumberedSpecificationRows(sourceText);
  if (numberedRows.length) return numberedRows;

  const markdownRows = parseMarkdownTableRows(sourceText);
  if (markdownRows.length) return markdownRows;

  const sectionB = cleanAiSectionTitle(extractAiSection(sourceText, "B"));
  const source = sectionB || sourceText;
  const name = firstMatch(source, [
    /Наименование(?: товара)?\s*[:\-]\s*([^\n]+)/i,
    /Товар\s*[:\-]\s*([^\n]+)/i,
    /Номенклатура\s*[:\-]\s*([^\n]+)/i,
  ]);
  const quantity = firstMatch(source, [
    /Кол-?во\s*[:\-]\s*([^\n]+)/i,
    /Количество(?: по запросу клиента)?\s*[:\-]\s*([^\n]+)/i,
  ]);
  const price = firstMatch(source, [
    /Цена(?: за ед\.? изм\.?)?(?:[^:\n]*НДС[^:\n]*)?\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
    /Цена с НДС\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
  ]);
  const sum = firstMatch(source, [
    /Сумма(?: с НДС[^:\n]*)?\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
    /Итого(?: с НДС)?\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
  ]);
  const unit = firstMatch(source, [
    /Ед\.?\s*изм\.?\s*[:\-]\s*([^\n]+)/i,
    /Единица измерения\s*[:\-]\s*([^\n]+)/i,
  ]) || unitFromQuantity(quantity);
  const code = firstMatch(source, [
    /Код\s*[:\-]\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
    /Артикул\s*[:\-]\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
  ]);
  const warranty = firstMatch(source, [/Гарантия\s*[:\-]\s*([^\n]+)/i]) || KBI_DEFAULT_WARRANTY;
  const computedSum = sum || computeRowSum(quantity, price);

  if (!name && !code) return [];

  return [
    makeAppendixRow(1, {
      code,
      name,
      unit,
      quantity,
      price,
      sum: computedSum,
      warranty,
    }),
  ];
}

function parseNumberedSpecificationRows(sourceText: string): AppendixTableRow[] {
  const codeRows = parseCodeRows(sourceText);
  const rows: AppendixTableRow[] = [];
  const linePattern = /^\s*(\d+)\.\s+\*?(.+?)\*?\s+—\s+\*\*?([0-9\s.,]+)\s*([A-Za-zА-Яа-я.]+)\.?\*?\*?\s+—\s+Цена:\s*([0-9\s.,]+)[^\n—]*(?:—\s+Сумма:\s*([0-9\s.,]+))?/gim;
  for (const match of sourceText.matchAll(linePattern)) {
    const index = rows.length;
    const name = cleanAppendixValue(match[2]).replace(/,\s*$/, "");
    const quantity = cleanAppendixValue(match[3]);
    const unit = cleanAppendixValue(match[4]);
    const price = cleanAppendixValue(match[5]);
    const sum = cleanAppendixValue(match[6]) || computeRowSum(quantity, price);
    const codeRow = codeRows[index] || null;

    rows.push(makeAppendixRow(rows.length + 1, {
      code: codeRow?.code || "",
      name,
      unit: codeRow?.unit || normalizeUnit(unit),
      quantity: codeRow?.quantity || quantity,
      price: codeRow?.price || price,
      sum: codeRow?.sum || sum,
      warranty: KBI_DEFAULT_WARRANTY,
    }));
  }
  return rows;
}

function parseCodeRows(sourceText: string): Array<Partial<AppendixTableRow>> {
  const rows: Array<Partial<AppendixTableRow>> = [];
  const codePattern = /Код\s+`?([^`\s—]+)`?\s+—\s+Количество:\s*([0-9\s.,]+)\s*([A-Za-zА-Яа-я.]+)?\s*—\s+Цена:\s*([0-9\s.,]+)/gim;
  for (const match of sourceText.matchAll(codePattern)) {
    const quantity = cleanAppendixValue(match[2]);
    const unit = normalizeUnit(match[3] || "шт");
    const price = cleanAppendixValue(match[4]);
    rows.push({
      code: cleanAppendixValue(match[1]),
      unit,
      quantity,
      price,
      sum: computeRowSum(quantity, price),
    });
  }
  return rows;
}

function parseMarkdownTableRows(sourceText: string): AppendixTableRow[] {
  const rows: AppendixTableRow[] = [];
  const tableLines = sourceText.split(/\r?\n/).filter((line) => line.includes("|"));
  for (const line of tableLines) {
    const cells = line.split("|").map((cell) => normalizeTableCell(cell)).filter(Boolean);
    if (cells.length < 6) continue;
    if (isMarkdownSeparatorRow(cells)) continue;
    if (isAppendixTableHeaderRow(cells)) continue;

    const row = cells.length >= 8
      ? makeAppendixRow(rows.length + 1, {
          code: cells[1],
          name: cells[2],
          unit: cells[3],
          quantity: cells[4],
          price: cells[5],
          sum: cells[6],
          warranty: cells[7],
        })
      : makeAppendixRow(rows.length + 1, {
          code: cells[0],
          name: cells[1],
          unit: cells[2],
          quantity: cells[3],
          price: cells[4],
          sum: cells[5],
          warranty: cells[6] || KBI_DEFAULT_WARRANTY,
        });
    if (isAppendixHeaderLikeRow(row)) continue;
    rows.push(row);
  }
  return rows;
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.some((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function isAppendixTableHeaderRow(cells: string[]): boolean {
  const normalizedCells = cells.map(normalizeHeaderCell);
  const firstCell = normalizedCells[0] || "";
  if (firstCell.startsWith("№") || ["#", "n", "no"].includes(firstCell)) return true;

  const headerHits = normalizedCells.filter((cell) => {
    return cell === "код"
      || cell.includes("товар")
      || cell.includes("работ")
      || cell.includes("услуг")
      || cell.includes("наименование")
      || cell.includes("ед")
      || cell.includes("кол")
      || cell.includes("цена")
      || cell.includes("ставка ндс")
      || cell.includes("сумма")
      || cell.includes("гарантия");
  }).length;

  return headerHits >= 2;
}

function isAppendixHeaderLikeRow(row: AppendixTableRow): boolean {
  const code = normalizeHeaderCell(row.code);
  const name = normalizeHeaderCell(row.name);
  return code === "код"
    || name.startsWith("№")
    || name === "товары"
    || name.includes("товары работы")
    || name.includes("работы услуги")
    || name.includes("наименование");
}

function normalizeHeaderCell(value: string): string {
  return cleanAppendixValue(value)
    .toLowerCase()
    .replace(/[().,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeAppendixRow(number: number, raw: Partial<AppendixTableRow>): AppendixTableRow {
  const sum = cleanAppendixValue(raw.sum) || computeRowSum(raw.quantity || "", raw.price || "");
  return {
    number,
    code: cleanAppendixValue(raw.code) || "уточняется",
    name: cleanAppendixValue(raw.name) || "Наименование товара уточняется по счету",
    unit: cleanAppendixValue(raw.unit) || unitFromQuantity(raw.quantity || "") || "шт.",
    quantity: cleanQuantity(raw.quantity) || "уточняется",
    price: formatMoneyText(raw.price),
    sum: formatMoneyText(sum),
    warranty: normalizeWarranty(raw.warranty),
    sumValue: parseMoneyText(sum),
  };
}

function buildKbiAppendixText(data: KbiAppendixData): string {
  const rows = data.rows
    .map((row) => `${row.number}. ${row.code} | ${row.name} | ${row.unit} | ${row.quantity} | ${row.price} | ${row.sum} | ${row.warranty}`)
    .join("\n");
  return [
    `Приложение № ____ от ${data.appendixDateRu}`,
    `к Договору поставки № ${data.contractNumber}`,
    `от ${data.contractDateRu}`,
    "",
    "№ | Код | Наименование | Ед. изм. | Кол-во | Цена за ед. изм., с НДС 16% | Сумма с НДС 16% | Гарантия",
    rows,
    "",
    `Общая стоимость составляет ${data.totalText} (${data.totalWords}) тенге 00 тиын, с учетом НДС 16%.`,
    `Условия поставки и место: ${data.deliveryPlace}`,
    `Срок оплаты: ${data.paymentTerm}`,
    "",
    "Подписи Сторон:",
    "",
    KBI_BUYER_REQUISITES.join("\n"),
    "",
    MICHAEL_SUPPLIER_REQUISITES.join("\n"),
  ].join("\n");
}

function buildAppendixHtml(data: KbiAppendixData): string {
  const tableRows = data.rows.map((row) => `
      <tr>
        <td class="center">${row.number}</td>
        <td class="center">${escapeHtml(row.code)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="center">${escapeHtml(row.unit)}</td>
        <td class="center">${escapeHtml(row.quantity)}</td>
        <td class="money">${escapeHtml(row.price)}</td>
        <td class="money">${escapeHtml(row.sum)}</td>
        <td class="center">${escapeHtml(row.warranty)}</td>
      </tr>
    `).join("");
  const buyerRequisites = renderRequisites(KBI_BUYER_REQUISITES);
  const supplierRequisites = renderRequisites(MICHAEL_SUPPLIER_REQUISITES);

  return [
    "<!doctype html>",
    '<html lang="ru">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Приложение к договору - заявка ${data.requestId}</title>`,
    "<style>",
    "@page { size: A4; margin: 16mm 12mm 14mm 12mm; }",
    "body { font-family: 'Times New Roman', Times, serif; color: #111; font-size: 12pt; line-height: 1.15; }",
    "p { margin: 0 0 8px; }",
    ".appendix-title { font-weight: 700; margin: 0 auto 42px; text-align: center; width: 360px; }",
    ".appendix-title p { margin: 0; }",
    "table.items { border-collapse: collapse; margin: 0 auto 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt; table-layout: fixed; width: 100%; }",
    ".items th, .items td { border: 1px solid #333; font-size: 9pt; overflow-wrap: anywhere; padding: 2px 3px; vertical-align: middle; word-break: break-word; word-wrap: break-word; }",
    ".items th { font-weight: 700; line-height: 1.05; text-align: center; }",
    ".center { text-align: center; }",
    ".money { text-align: right; }",
    ".summary { margin-top: 0; }",
    ".terms { margin-top: 18px; }",
    ".sign-title { font-weight: 700; margin: 54px 0 16px; text-align: center; }",
    ".requisites-table { border-collapse: collapse; table-layout: fixed; width: 100%; }",
    ".requisites-table td { border: 0; padding: 0; vertical-align: top; width: 50%; }",
    ".requisites-table td:first-child { padding-right: 29px; }",
    ".requisites-table td:last-child { padding-left: 29px; }",
    ".party p { margin: 0; }",
    ".party p:nth-child(1), .party p:nth-child(2), .party .bold { font-weight: 700; }",
    ".party .italic { font-style: italic; }",
    ".signature-cell { padding-top: 46px !important; }",
    ".signature-role { font-weight: 400; margin: 0 0 2px; }",
    ".signature-name { margin: 0; }",
    "</style>",
    "</head>",
    "<body>",
    '<div class="appendix-title">',
    `<p>Приложение №____ от ${escapeHtml(data.appendixDateRu)}</p>`,
    `<p>к Договору поставки № ${escapeHtml(data.contractNumber)}</p>`,
    `<p>от ${escapeHtml(data.contractDateRu)}</p>`,
    "</div>",
    '<table class="items">',
    "<colgroup>",
    '<col style="width: 3%">',
    '<col style="width: 12.5%">',
    '<col style="width: 47%">',
    '<col style="width: 4%">',
    '<col style="width: 4.5%">',
    '<col style="width: 11.5%">',
    '<col style="width: 11%">',
    '<col style="width: 6.5%">',
    "</colgroup>",
    "<thead>",
    "<tr>",
    "<th>№</th>",
    "<th>Код</th>",
    "<th>Наименование</th>",
    "<th>Ед.<br>изм.</th>",
    "<th>Кол-<br>во</th>",
    "<th>Цена за ед. изм.,<br>с НДС 16%</th>",
    "<th>Сумма с<br>НДС 16%</th>",
    "<th>Гарантия</th>",
    "</tr>",
    "</thead>",
    `<tbody>${tableRows}</tbody>`,
    "</table>",
    `<p class="summary">Общая стоимость составляет ${escapeHtml(data.totalText)} (${escapeHtml(data.totalWords)}) тенге 00 тиын, с учетом НДС 16%.</p>`,
    '<div class="terms">',
    `<p>Условия поставки и место: ${escapeHtml(data.deliveryPlace)}</p>`,
    `<p>Срок оплаты: ${escapeHtml(data.paymentTerm)}</p>`,
    "</div>",
    '<p class="sign-title">Подписи Сторон:</p>',
    '<table class="requisites-table">',
    "<tr>",
    `<td class="party">${buyerRequisites}</td>`,
    `<td class="party">${supplierRequisites}</td>`,
    "</tr>",
    "<tr>",
    `<td class="signature-cell">${renderPartySignature(KBI_BUYER_SIGNATORY)}</td>`,
    `<td class="signature-cell">${renderPartySignature(MICHAEL_SUPPLIER_SIGNATORY)}</td>`,
    "</tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderPartySignature(name: string): string {
  return [
    '<div>',
    '<p class="signature-role">Директор</p>',
    `<p class="signature-name">${escapeHtml(name)}</p>`,
    "</div>",
  ].join("");
}

function renderRequisites(lines: string[]): string {
  return lines.map((line) => {
    const className = ["юридический адрес:", "фактический адрес:"].includes(line)
        ? "italic"
        : line.endsWith(":")
          ? "bold"
          : "";
    return `<p${className ? ` class="${className}"` : ""}>${escapeHtml(line)}</p>`;
  }).join("\n");
}

function firstMatch(value: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return cleanAppendixValue(match[1]);
  }
  return "";
}

function cleanAppendixValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/^\s*[-•]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTableCell(value: string): string {
  return cleanAppendixValue(value.replace(/<br\s*\/?>/gi, " "));
}

function cleanQuantity(value: unknown): string {
  const text = cleanAppendixValue(value);
  if (!text) return "";
  const match = text.match(/([0-9]+(?:[,.][0-9]+)?)/);
  return match ? match[1].replace(".", ",") : text;
}

function normalizeWarranty(value: unknown): string {
  const text = cleanAppendixValue(value);
  if (!text || text.toLowerCase().includes("уточняется")) return KBI_DEFAULT_WARRANTY;
  return text;
}

function normalizeUnit(value: string): string {
  const normalized = cleanAppendixValue(value).toLowerCase().replace(/\.$/, "");
  if (!normalized) return "";
  if (normalized === "шт" || normalized.includes("штук")) return "шт.";
  if (normalized === "м" || normalized.includes("метр")) return "м";
  if (normalized === "кг") return "кг";
  if (normalized.includes("компл")) return "компл.";
  return cleanAppendixValue(value);
}

function unitFromQuantity(value: string): string {
  const text = cleanAppendixValue(value).toLowerCase();
  if (!text) return "";
  if (/\bм\b|метр/.test(text)) return "м";
  if (/шт/.test(text)) return "шт.";
  if (/компл/.test(text)) return "компл.";
  if (/кг/.test(text)) return "кг";
  return "";
}

function formatMoneyText(value: unknown): string {
  const amount = parseMoneyText(value);
  return amount === null ? "уточняется" : formatMoney(amount);
}

function computeRowSum(quantityValue: unknown, priceValue: unknown): string {
  const quantityText = cleanAppendixValue(quantityValue);
  const price = parseMoneyText(priceValue);
  const quantityMatch = quantityText.match(/([0-9]+(?:[,.][0-9]+)?)/);
  if (price === null || !quantityMatch) return "";
  const quantity = Number(quantityMatch[1].replace(",", "."));
  if (!Number.isFinite(quantity)) return "";
  return formatMoney(quantity * price);
}

function parseMoneyText(value: unknown): number | null {
  const text = cleanAppendixValue(value);
  if (!text || text === "уточняется") return null;
  const match = text.match(/-?[0-9][0-9\s]*(?:[,.][0-9]{1,2})?/);
  if (!match) return null;
  const normalized = match[0].replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const [integerPart, fractionPart] = rounded.toFixed(2).split(".");
  return `${integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${fractionPart}`;
}

function formatRuDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const months = [
    "",
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  return `${day} ${months[month]} ${year} года`;
}

function extractDeliveryPlace(sourceText: string): string {
  const delivery = firstMatch(sourceText, [
    /Условия поставки и место\s*[:\-]\s*([^\n]+)/i,
    /Место поставки\s*[:\-]\s*([^\n]+)/i,
    /Доставка\s*[:\-]\s*([^\n]+)/i,
  ]);
  return delivery.toLowerCase().includes("ddp") ? delivery : "";
}

function extractPaymentTerm(sourceText: string): string {
  return firstMatch(sourceText, [
    /Срок оплаты\s*[:\-]\s*([^\n]+)/i,
    /Условия оплаты\s*[:\-]\s*([^\n]+)/i,
  ]);
}

function moneyToRussianWords(amount: number): string {
  const integer = Math.max(0, Math.floor(amount));
  if (integer === 0) return "ноль";

  const units = [
    { forms: ["", "", ""], gender: "male" },
    { forms: ["тысяча", "тысячи", "тысяч"], gender: "female" },
    { forms: ["миллион", "миллиона", "миллионов"], gender: "male" },
    { forms: ["миллиард", "миллиарда", "миллиардов"], gender: "male" },
  ];
  const parts: string[] = [];
  let rest = integer;
  let groupIndex = 0;

  while (rest > 0 && groupIndex < units.length) {
    const group = rest % 1000;
    if (group > 0) {
      const unit = units[groupIndex];
      const words = triadToRussianWords(group, unit.gender);
      const form = unit.forms[0] ? pluralRu(group, unit.forms) : "";
      parts.unshift([words, form].filter(Boolean).join(" "));
    }
    rest = Math.floor(rest / 1000);
    groupIndex += 1;
  }

  return parts.join(" ");
}

function triadToRussianWords(value: number, gender: string): string {
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const tens = ["", "десять", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const onesMale = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const onesFemale = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const ones = gender === "female" ? onesFemale : onesMale;
  const result: string[] = [];
  const hundred = Math.floor(value / 100);
  const lastTwo = value % 100;
  const one = value % 10;

  if (hundred) result.push(hundreds[hundred]);
  if (lastTwo >= 10 && lastTwo <= 19) {
    result.push(teens[lastTwo - 10]);
  } else {
    const ten = Math.floor(lastTwo / 10);
    if (ten) result.push(tens[ten]);
    if (one) result.push(ones[one]);
  }
  return result.join(" ");
}

function pluralRu(value: number, forms: string[]): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function capitalizeFirst(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function extractInvoiceNumber(value: string): string {
  return firstMatch(value, [
    /счет(?:а|у)?\s+на\s+оплату\s*№\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
    /счет\s*№\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
    /№\s*([0-9]{3,})\s+от\s+\d{1,2}[.\s]/i,
  ]);
}

function extractInvoiceDate(value: string): string {
  const numeric = value.match(/(?:счет(?:а|у)?(?:\s+на\s+оплату)?\s*№\s*[0-9A-Za-zА-Яа-я._/-]+\s*от\s*)(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;

  const ru = value.match(/(?:счет(?:а|у)?(?:\s+на\s+оплату)?\s*№\s*[0-9A-Za-zА-Яа-я._/-]+\s*от\s*)(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (!ru) return "";
  const months: Record<string, string> = {
    января: "01",
    февраля: "02",
    марта: "03",
    апреля: "04",
    мая: "05",
    июня: "06",
    июля: "07",
    августа: "08",
    сентября: "09",
    октября: "10",
    ноября: "11",
    декабря: "12",
  };
  const month = months[ru[2].toLowerCase()];
  return month ? `${ru[3]}-${month}-${ru[1].padStart(2, "0")}` : "";
}

function buildAppendixFileName(requestId: number, invoiceNumber: string, clientCompany: string): string {
  const invoicePart = invoiceNumber === "уточняется" ? `request-${requestId}` : `invoice-${invoiceNumber}`;
  return sanitizeFileName(`appendix-${clientCompany}-${invoicePart}.doc`);
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function listRequestEvents(env: Env, requestId: number) {
  const result = await env.DB.prepare(`
    SELECT * FROM request_events
    WHERE request_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).bind(requestId).all();
  return result.results;
}

async function listRequestTasks(env: Env, requestId: number) {
  const result = await env.DB.prepare(`
    SELECT * FROM request_tasks
    WHERE request_id = ?
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
      COALESCE(due_date, '9999-12-31') ASC,
      id ASC
  `).bind(requestId).all();
  return result.results;
}

async function listOpenTasks(env: Env) {
  const result = await env.DB.prepare(`
    SELECT
      t.*,
      r.client_company,
      r.client_contact_name,
      r.michael_manager,
      r.communication_channel,
      r.priority,
      r.requires_contract_appendix,
      r.invoice_status,
      r.contract_appendix_status
    FROM request_tasks t
    INNER JOIN requests r ON r.id = t.request_id
    WHERE t.status = 'open'
      AND r.status NOT IN ('done', 'closed', 'lost')
    ORDER BY
      CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      COALESCE(t.due_date, '9999-12-31') ASC,
      t.created_at ASC
    LIMIT 50
  `).all();
  return result.results;
}

async function getRequestTask(env: Env, requestId: number, taskId: number) {
  return env.DB.prepare(`
    SELECT * FROM request_tasks
    WHERE request_id = ? AND id = ?
  `).bind(requestId, taskId).first();
}

async function createRequestTask(request: Request, env: Env, requestId: number) {
  const existingRequest = await getRequest(env, requestId);
  if (!existingRequest) return null;

  const payload = (await request.json()) as {
    title?: string;
    status?: string;
    owner_name?: string;
    due_date?: string;
    actor?: string;
  };
  const title = normalizeOptionalText(payload.title);
  if (!title) throw new Error("Название задачи пустое.");

  const status = normalizeTaskStatus(payload.status || "open");
  const ownerName = normalizeOptionalText(payload.owner_name);
  const dueDate = normalizeIsoDate(payload.due_date);
  const completedAt = status === "done" ? new Date().toISOString() : null;
  const actor = normalizeOptionalText(payload.actor) || "manager";

  const result = await env.DB.prepare(`
    INSERT INTO request_tasks (request_id, title, status, owner_name, due_date, completed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(requestId, title, status, ownerName || null, dueDate || null, completedAt).run();

  const taskId = Number(result.meta.last_row_id);
  await createRequestEvent(env, requestId, "request.task_created", actor, {
    task_id: taskId,
    title,
    status,
    owner_name: ownerName || null,
    due_date: dueDate || null,
  });

  return getRequestTask(env, requestId, taskId);
}

async function updateRequestTask(request: Request, env: Env, requestId: number, taskId: number) {
  const existing = await getRequestTask(env, requestId, taskId) as Record<string, any> | null;
  if (!existing) return null;

  const payload = (await request.json()) as {
    title?: string;
    status?: string;
    owner_name?: string;
    due_date?: string;
    actor?: string;
  };
  const title = normalizeOptionalText(payload.title ?? existing.title);
  if (!title) throw new Error("Название задачи пустое.");

  const status = normalizeTaskStatus(payload.status || existing.status || "open");
  const ownerName = normalizeOptionalText(payload.owner_name ?? existing.owner_name);
  const dueDate = normalizeIsoDate(payload.due_date ?? existing.due_date);
  const completedAt = status === "done" ? (existing.completed_at || new Date().toISOString()) : null;
  const actor = normalizeOptionalText(payload.actor) || "manager";

  await env.DB.prepare(`
    UPDATE request_tasks
    SET title = ?, status = ?, owner_name = ?, due_date = ?, completed_at = ?
    WHERE request_id = ? AND id = ?
  `).bind(title, status, ownerName || null, dueDate || null, completedAt, requestId, taskId).run();

  await createRequestEvent(env, requestId, "request.task_updated", actor, {
    task_id: taskId,
    title,
    previous_status: existing.status || "open",
    status,
    owner_name: ownerName || null,
    due_date: dueDate || null,
    completed_at: completedAt,
  });

  return getRequestTask(env, requestId, taskId);
}

async function deleteRequestTask(env: Env, requestId: number, taskId: number, currentUser: CurrentUser) {
  const existing = await getRequestTask(env, requestId, taskId) as Record<string, any> | null;
  if (!existing) return null;

  await env.DB.prepare(`
    DELETE FROM request_tasks
    WHERE request_id = ? AND id = ?
  `).bind(requestId, taskId).run();

  await createRequestEvent(
    env,
    requestId,
    "request.task_deleted",
    currentUser.display_name || currentUser.username || "manager",
    {
      task_id: taskId,
      title: String(existing.title || ""),
      previous_status: existing.status || "open",
    },
  );

  return { ok: true, task_id: taskId };
}

async function createDefaultTasks(
  env: Env,
  requestId: number,
  item: Record<string, any>,
  requiresContractAppendix: boolean,
) {
  const ownerName = normalizeOptionalText(item.michael_manager);
  const tasks = [
    "Проверить наличие и цену с НДС",
    "Подготовить ответ клиенту",
  ];

  if (item.source_type === "audio") {
    tasks.unshift("Проверить транскрибацию голосового сообщения");
  }

  if (requiresContractAppendix) {
    tasks.push("Подготовить счет от ТОО Michael");
    tasks.push("Подготовить приложение к годовому договору");
  }

  for (const title of tasks) {
    await env.DB.prepare(`
      INSERT INTO request_tasks (request_id, title, owner_name)
      VALUES (?, ?, ?)
    `).bind(requestId, title, ownerName || null).run();
  }

  await createRequestEvent(env, requestId, "request.tasks_created", ownerName || "system", {
    count: tasks.length,
    requires_contract_appendix: requiresContractAppendix,
  });
}

async function getCrmSummary(env: Env) {
  const [clients, contacts, managers, openRequests, vipRequests, openTasks, overdueTasks, statusCounts] = await Promise.all([
    env.DB.prepare("SELECT * FROM crm_clients ORDER BY updated_at DESC LIMIT 100").all(),
    env.DB.prepare("SELECT * FROM crm_contacts ORDER BY updated_at DESC LIMIT 100").all(),
    env.DB.prepare("SELECT * FROM michael_managers ORDER BY display_name ASC LIMIT 100").all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE status NOT IN ('done', 'closed', 'lost')").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE client_type = 'vip'").first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM request_tasks t
      INNER JOIN requests r ON r.id = t.request_id
      WHERE t.status = 'open'
        AND r.status NOT IN ('done', 'closed', 'lost')
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM request_tasks t
      INNER JOIN requests r ON r.id = t.request_id
      WHERE t.status = 'open'
        AND t.due_date IS NOT NULL
        AND t.due_date < date('now')
        AND r.status NOT IN ('done', 'closed', 'lost')
    `).first(),
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM requests GROUP BY status ORDER BY count DESC").all(),
  ]);

  return {
    clients: clients.results,
    contacts: contacts.results,
    managers: managers.results,
    open_requests: Number((openRequests as Record<string, unknown> | null)?.count || 0),
    vip_requests: Number((vipRequests as Record<string, unknown> | null)?.count || 0),
    open_tasks: Number((openTasks as Record<string, unknown> | null)?.count || 0),
    overdue_tasks: Number((overdueTasks as Record<string, unknown> | null)?.count || 0),
    status_counts: statusCounts.results,
  };
}

async function ensureCrmLink(env: Env, metadata: Metadata): Promise<CrmLink> {
  const company = normalizeOptionalText(metadata.client_company);
  const contactName = normalizeOptionalText(metadata.client_contact_name);
  const managerName = normalizeOptionalText(metadata.michael_manager);
  const clientIsKbi = company ? isKbiEnergy(company) : false;
  const clientType: "standard" | "vip" = clientIsKbi ? "vip" : "standard";
  const contractNote = clientIsKbi
    ? "VIP клиент. Работа по годовому договору; каждый счет должен сопровождаться приложением к договору."
    : null;

  let clientId: number | null = null;
  let contactId: number | null = null;
  let michaelManagerId: number | null = null;

  if (company) {
    const normalized = normalizeKey(company);
    await env.DB.prepare(`
      INSERT INTO crm_clients (display_name, normalized_name, client_type, is_vip, contract_note, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        client_type = CASE
          WHEN crm_clients.client_type = 'vip' OR excluded.client_type = 'vip' THEN 'vip'
          ELSE excluded.client_type
        END,
        is_vip = CASE
          WHEN crm_clients.is_vip = 1 OR excluded.is_vip = 1 THEN 1
          ELSE excluded.is_vip
        END,
        contract_note = COALESCE(excluded.contract_note, crm_clients.contract_note),
        updated_at = datetime('now')
    `).bind(company, normalized, clientType, clientIsKbi ? 1 : 0, contractNote).run();
    const client = await env.DB.prepare("SELECT id FROM crm_clients WHERE normalized_name = ?").bind(normalized).first();
    clientId = client ? Number((client as Record<string, unknown>).id) : null;
  }

  if (clientId && contactName) {
    const normalized = normalizeKey(contactName);
    await env.DB.prepare(`
      INSERT INTO crm_contacts (client_id, display_name, normalized_name, channel_hint, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(client_id, normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        channel_hint = COALESCE(excluded.channel_hint, crm_contacts.channel_hint),
        updated_at = datetime('now')
    `).bind(clientId, contactName, normalized, metadata.communication_channel || null).run();
    const contact = await env.DB.prepare(`
      SELECT id FROM crm_contacts WHERE client_id = ? AND normalized_name = ?
    `).bind(clientId, normalized).first();
    contactId = contact ? Number((contact as Record<string, unknown>).id) : null;
  }

  if (managerName) {
    const normalized = normalizeKey(managerName);
    await env.DB.prepare(`
      INSERT INTO michael_managers (display_name, normalized_name, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = datetime('now')
    `).bind(managerName, normalized).run();
    const manager = await env.DB.prepare("SELECT id FROM michael_managers WHERE normalized_name = ?").bind(normalized).first();
    michaelManagerId = manager ? Number((manager as Record<string, unknown>).id) : null;
  }

  return {
    clientId,
    contactId,
    michaelManagerId,
    clientType,
    requiresContractAppendix: clientIsKbi,
  };
}

async function linkCrmClientOneCCounterparty(request: Request, env: Env, clientId: number, user: CurrentUser) {
  const existing = await env.DB.prepare("SELECT * FROM crm_clients WHERE id = ?").bind(clientId).first();
  if (!existing) return null;

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const candidate = normalizeOneCCounterpartyCandidate(payload);
  if (!candidate.counterparty_ref && !candidate.name && !candidate.bin) {
    throw new UserInputError("Выберите найденного контрагента 1С или передайте имя/БИН.");
  }

  await env.DB.prepare(`
    UPDATE crm_clients
    SET
      onec_counterparty_ref = ?,
      onec_counterparty_name = ?,
      onec_counterparty_full_name = ?,
      onec_counterparty_bin = ?,
      onec_counterparty_partner = ?,
      onec_counterparty_payload_json = ?,
      onec_counterparty_linked_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    candidate.counterparty_ref || null,
    candidate.name || null,
    candidate.full_name || null,
    candidate.bin || null,
    candidate.partner || null,
    JSON.stringify(candidate.raw || payload),
    clientId,
  ).run();

  const requestId = Number(payload.request_id || 0);
  if (requestId > 0) {
    const requestItem = await getRequest(env, requestId) as Record<string, unknown> | null;
    if (requestItem && Number(requestItem.client_id || 0) === clientId) {
      await createRequestEvent(env, requestId, "client.onec_counterparty_linked", user.display_name || user.username, {
        client_id: clientId,
        counterparty_ref: candidate.counterparty_ref || null,
        name: candidate.name || null,
        full_name: candidate.full_name || null,
        bin: candidate.bin || null,
        partner: candidate.partner || null,
      });
    }
  }

  return env.DB.prepare("SELECT * FROM crm_clients WHERE id = ?").bind(clientId).first();
}

async function createRequestEvent(
  env: Env,
  requestId: number,
  eventType: string,
  actor: string,
  payload: Record<string, unknown>,
) {
  await env.DB.prepare(`
    INSERT INTO request_events (request_id, event_type, actor, payload_json)
    VALUES (?, ?, ?, ?)
  `).bind(requestId, eventType, actor, JSON.stringify(payload)).run();
}

function buildContextPrefix(metadata: Metadata): string {
  const parts = [
    metadata.client_company ? `Компания клиента: ${metadata.client_company}` : "",
    metadata.client_contact_name ? `Контакт/менеджер клиента: ${metadata.client_contact_name}` : "",
    metadata.michael_manager ? `Менеджер Michael: ${metadata.michael_manager}` : "",
    metadata.communication_channel ? `Канал связи: ${metadata.communication_channel}` : "",
    metadata.priority ? `Приоритет: ${metadata.priority}` : "",
    metadata.next_action ? `Следующее действие: ${metadata.next_action}` : "",
  ].filter(Boolean);
  return parts.length ? `Контекст заявки:\n${parts.join("\n")}\n\n` : "";
}

function appendTextBlock(baseText: string, blockText: string): string {
  const base = normalizeOptionalText(baseText);
  const block = normalizeOptionalText(blockText);
  if (!block) return base;
  if (!base) return block;
  return `${base}\n\n${block}`;
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function isKbiEnergy(company: string): boolean {
  const normalized = normalizeKey(company);
  return normalized.includes("kbi energy") || normalized.includes("кби энерджи");
}

function detectKbiEnergy(value: string): boolean {
  const normalized = normalizeKey(value);
  return normalized.includes("kbi") || normalized.includes("кби");
}

function normalizeStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "new";
  const allowed = new Set([
    "new",
    "in_progress",
    "need_clarification",
    "reply_ready",
    "quote_sent",
    "invoice_required",
    "invoice_sent",
    "done",
    "closed",
    "lost",
  ]);
  return allowed.has(normalized) ? normalized : "new";
}

function normalizePriority(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "normal";
  return ["low", "normal", "high", "urgent"].includes(normalized) ? normalized : "normal";
}

function normalizeInvoiceStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "not_required";
  const allowed = ["not_required", "required", "prepared", "sent", "paid", "cancelled"];
  return allowed.includes(normalized) ? normalized : "not_required";
}

function normalizeAppendixStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "not_required";
  const allowed = ["not_required", "required", "prepared", "sent", "signed", "cancelled"];
  return allowed.includes(normalized) ? normalized : "not_required";
}

function normalizeTaskStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "open";
  return ["open", "done", "cancelled"].includes(normalized) ? normalized : "open";
}

function normalizeEmailFolder(value: unknown): EmailFolder | "" {
  const normalized = normalizeOptionalText(value);
  return (EMAIL_FOLDERS as string[]).includes(normalized) ? normalized as EmailFolder : "";
}

function normalizeEmailSenderRouteFolder(value: unknown): EmailFolder | "" {
  const folder = normalizeEmailFolder(value);
  return folder && EMAIL_SENDER_ROUTE_FOLDERS.includes(folder) ? folder : "";
}

function isEmailSenderRouteFolder(folder: EmailFolder): boolean {
  return EMAIL_SENDER_ROUTE_FOLDERS.includes(folder);
}

function normalizeEmailStatus(value: unknown): EmailStatus | "" {
  const normalized = normalizeOptionalText(value);
  return (EMAIL_STATUSES as string[]).includes(normalized) ? normalized as EmailStatus : "";
}

function emailStatusForFolder(folder: EmailFolder): EmailStatus {
  if (folder === "in_work") return "in_work";
  if (folder === "done") return "done";
  if (folder === "trash") return "deleted";
  return "received";
}

function emailFolderForStatus(status: EmailStatus): EmailFolder {
  if (status === "in_work") return "in_work";
  if (status === "done") return "done";
  if (status === "deleted") return "trash";
  return "inbox";
}

function normalizeIsoDate(value: unknown): string {
  const normalized = normalizeOptionalText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function isImage(fileName: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp"].some((extension) => fileName.endsWith(extension));
}

function isAudio(fileName: string): boolean {
  return [".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm"].some((extension) => fileName.endsWith(extension));
}

function isDocument(fileName: string): boolean {
  return [".pdf", ".docx", ".xlsx"].some((extension) => fileName.endsWith(extension));
}

function normalizeWhatsAppTemplateName(value: unknown): string {
  return normalizeOptionalText(value).toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function normalizeWhatsAppTemplateKey(value: unknown): string {
  return normalizeWhatsAppTemplateName(value);
}

function normalizeWhatsAppLanguageCode(value: unknown): string {
  const normalized = normalizeOptionalText(value).replace(/[^A-Za-z0-9_-]/g, "");
  return normalized || "ru";
}

function normalizeWhatsAppTemplateCategory(value: unknown): string {
  const normalized = normalizeOptionalText(value).toUpperCase();
  return ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(normalized) ? normalized : "UTILITY";
}

function normalizeWhatsAppApiVersion(value: unknown): string {
  const normalized = normalizeOptionalText(value);
  return /^v\d+\.\d+$/.test(normalized) ? normalized : "v24.0";
}

function normalizeWhatsAppPhone(value: unknown): string {
  let digits = normalizeOptionalText(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function normalizeWhatsAppBodyParameters(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeOptionalText(item).slice(0, 1024))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeMcpToolName(value: unknown): string {
  return normalizeOptionalText(value).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128);
}

async function oneCSearchPayload(request: Request, emptyMessage: string): Promise<{ search: string; pattern: string }> {
  const payload = await request.json().catch(() => ({})) as { query?: unknown; search?: unknown };
  const search = normalizeOptionalText(payload.query || payload.search).slice(0, 160);
  if (!search) throw new UserInputError(emptyMessage);
  return {
    search,
    pattern: oneCSearchPattern(search),
  };
}

function oneCSearchPattern(value: string): string {
  return value.includes("%") ? value : `%${value}%`;
}

function oneCClientSearchParameters(search: string): Record<string, string> {
  const normalized = normalizeOneCClientSearch(search);
  return {
    Поиск: oneCSearchPattern(search),
    ПоискОчищенный: oneCSearchPattern(normalized || search),
  };
}

function normalizeOneCClientSearch(value: string): string {
  const legalFormPattern = "(?:ТОО|ИП|АО|ЗАО|ОАО|TOO|LLP|LLC)";
  return normalizeOptionalText(value)
    .replace(/[«»"]/g, "")
    .replace(/\s+/g, " ")
    .replace(new RegExp(`^${legalFormPattern}\\s+`, "i"), "")
    .replace(new RegExp(`\\s+${legalFormPattern}$`, "i"), "")
    .trim();
}

async function findLinkedOneCCounterparty(env: Env, company: string): Promise<Record<string, string> | null> {
  const normalized = normalizeKey(company);
  const cleaned = normalizeKey(normalizeOneCClientSearch(company));
  const rows = await env.DB.prepare(`
    SELECT
      display_name,
      normalized_name,
      onec_counterparty_ref,
      onec_counterparty_name,
      onec_counterparty_full_name,
      onec_counterparty_bin,
      onec_counterparty_partner,
      onec_counterparty_linked_at
    FROM crm_clients
    WHERE onec_counterparty_linked_at IS NOT NULL
      AND (
        normalized_name = ?
        OR normalized_name = ?
        OR (? <> '' AND normalized_name LIKE ?)
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(normalized, cleaned, cleaned, cleaned ? `%${cleaned}%` : "").first();
  return rows as Record<string, string> | null;
}

function oneCMcpResultText(response: any): string {
  const content = response?.result?.content || response?.content || [];
  if (Array.isArray(content) && content.length > 0) {
    const text = content
      .map((item: any) => normalizeOptionalText(item?.text || item?.content))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text) return text;
  }
  return JSON.stringify(response, null, 2);
}

function parseOneCCounterpartyCandidates(text: string): Record<string, unknown>[] {
  const rows = [
    ...parseOneCMarkdownTableRows(text),
    ...parseKeyValueBlockRows(text),
  ];
  return rows
    .map((row) => normalizeOneCCounterpartyCandidate(row))
    .filter((item) => Boolean(item.counterparty_ref || item.name || item.full_name || item.bin))
    .slice(0, 10);
}

function parseOneCMarkdownTableRows(text: string): Record<string, string>[] {
  const tableLines = normalizeOptionalText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (tableLines.length < 2) return [];

  const header = splitMarkdownTableRow(tableLines[0]);
  if (header.length === 0) return [];

  return tableLines.slice(1)
    .filter((line) => !/^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|$/.test(line))
    .map((line) => splitMarkdownTableRow(line))
    .filter((cells) => cells.length > 0)
    .map((cells) => {
      const row: Record<string, string> = {};
      header.forEach((key, index) => {
        row[key] = cells[index] || "";
      });
      return row;
    });
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseKeyValueBlockRows(text: string): Record<string, string>[] {
  const blocks = normalizeOptionalText(text)
    .split(/\n\s*\n|-{3,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const row: Record<string, string> = {};
      for (const line of block.split(/\r?\n/)) {
        const match = line.match(/^\s*([^:=]{2,40})\s*[:=]\s*(.+?)\s*$/);
        if (match) row[match[1].trim()] = match[2].trim();
      }
      return row;
    })
    .filter((row) => Object.keys(row).length >= 2);
}

function normalizeOneCCounterpartyCandidate(row: Record<string, unknown>) {
  const value = (...keys: string[]) => {
    for (const key of keys) {
      const direct = normalizeOptionalText(row[key]);
      if (direct) return direct;

      const normalizedKey = normalizeColumnKey(key);
      const matchingKey = Object.keys(row).find((candidateKey) => normalizeColumnKey(candidateKey) === normalizedKey);
      if (matchingKey) {
        const matched = normalizeOptionalText(row[matchingKey]);
        if (matched) return matched;
      }
    }
    return "";
  };

  const candidate = {
    counterparty_ref: value("counterparty_ref", "Контрагент", "Ссылка", "Ref", "СсылкаКонтрагента"),
    name: value("name", "Наименование", "КонтрагентНаименование"),
    full_name: value("full_name", "НаименованиеПолное", "ПолноеНаименование", "Полное наименование"),
    bin: value("bin", "БИН", "ИНН", "ИИН", "Код"),
    partner: value("partner", "Партнер", "Партнёр"),
    raw: row,
  };

  if (!candidate.name && candidate.counterparty_ref && !/^[0-9a-f-]{20,}$/i.test(candidate.counterparty_ref)) {
    candidate.name = candidate.counterparty_ref;
  }

  return candidate;
}

function normalizeColumnKey(value: string): string {
  return normalizeOptionalText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]/g, "");
}

function detectOneCClientSearch(metadata: Metadata, sourceText: string): string {
  const company = normalizeOptionalText(metadata.client_company);
  if (company) return company;
  const bin = sourceText.match(/\b(?:БИН|ИИН|бин|иин)\s*[:№#-]?\s*(\d{12})\b/);
  if (bin) return bin[1];
  if (detectKbiEnergy(sourceText)) return "KBI Energy";
  return "";
}

function detectOneCProductSearch(sourceText: string): string {
  const text = normalizeOptionalText(sourceText);
  if (!text) return "";

  const labeledMatch = text.match(/(?:артикул|арт\.?|код|sku)\s*[:№#-]?\s*([A-Za-zА-Яа-я0-9._/-]{3,40})/i);
  const labeledValue = sanitizeOneCSearchTerm(labeledMatch?.[1] || "");
  if (labeledValue) return labeledValue;

  const codePatterns = [
    /\b[А-ЯA-Z]{1,4}-\d{5,}\b/giu,
    /\b\d{2}-\d{4,}\b/g,
  ];
  for (const pattern of codePatterns) {
    const match = text.match(pattern);
    const value = sanitizeOneCSearchTerm(match?.[0] || "");
    if (value) return value;
  }

  const productLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /(?:товар|номенклатура|наименование|нужен|нужно|просит|запрашивает)/i.test(line) && line.length >= 10);
  if (!productLine) return "";

  const cleanedLine = productLine
    .replace(/^.*?(?:товар|номенклатура|наименование|нужен|нужно|просит|запрашивает)\s*[:№#-]?\s*/i, "")
    .split(/[.;]/)[0]
    .trim();
  return sanitizeOneCSearchTerm(cleanedLine).slice(0, 80);
}

function sanitizeOneCSearchTerm(value: string): string {
  return normalizeOptionalText(value)
    .replace(/^[:"'«»()[\]{}.,;]+|[:"'«»()[\]{}.,;]+$/g, "")
    .trim();
}

function safeOneCErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : normalizeOptionalText(error);
  if (!message) return "проверка не выполнена";
  if (message.includes("ONEC_MCP_BRIDGE_URL")) return "bridge 1С не настроен";
  if (message.includes("fetch failed") || message.includes("network") || message.includes("недоступен")) return "bridge 1С недоступен";
  return limitText(message, 220);
}

function oneCMcpAllowedTools(env: Env): string[] {
  const configured = (env.ONEC_MCP_ALLOWED_TOOLS || "")
    .split(",")
    .map((tool) => normalizeMcpToolName(tool))
    .filter(Boolean);
  return configured.length > 0 ? Array.from(new Set(configured)) : DEFAULT_ONEC_MCP_ALLOWED_TOOLS;
}

function oneCMcpBridgeBaseUrl(env: Env): string {
  const baseUrl = (env.ONEC_MCP_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("ONEC_MCP_BRIDGE_URL не задан. Запустите onec-mcp-bridge рядом с 1С и укажите его HTTPS URL в Worker.");
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new Error("ONEC_MCP_BRIDGE_URL задан в неверном формате.");
  }
  return baseUrl;
}

function oneCMcpBridgeHeaders(env: Env, jsonBody = false): Headers {
  const headers = new Headers();
  if (jsonBody) headers.set("Content-Type", "application/json");
  if (env.ONEC_MCP_BRIDGE_TOKEN) {
    headers.set("Authorization", `Bearer ${env.ONEC_MCP_BRIDGE_TOKEN}`);
    headers.set("X-OneC-MCP-Token", env.ONEC_MCP_BRIDGE_TOKEN);
  }
  return headers;
}

async function readJsonResponse(response: Response): Promise<{ raw: string; data: any }> {
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  return { raw, data };
}

function normalizeMetaError(data: any, raw: string, fallback: string): string {
  return normalizeOptionalText(data?.error?.message)
    || normalizeOptionalText(data?.error?.error_user_msg)
    || normalizeOptionalText(raw)
    || fallback
    || "неизвестная ошибка";
}

function maskIdentifier(value: string): string {
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function isPdf(fileName: string): boolean {
  return fileName.endsWith(".pdf");
}

function isParserServiceConfigured(env: Env): boolean {
  return Boolean((env.PARSER_SERVICE_URL || "").trim());
}

type FilePayload = {
  mimeType: string;
  base64: string;
  dataUrl: string;
};

async function fileToPayload(file: File): Promise<FilePayload> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const mimeType = file.type || "application/octet-stream";
  const base64 = btoa(binary);
  return {
    mimeType,
    base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

async function parseDocumentWithService(env: Env, file: File): Promise<ParsedDocument> {
  const baseUrl = (env.PARSER_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(
      "PARSER_SERVICE_URL не задан. Для DOCX/XLSX запустите parser-service и укажите его URL в настройках Worker. PDF при AI_PROVIDER=gemini обрабатывается напрямую.",
    );
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "uploaded-file");

  const headers = new Headers();
  if (env.PARSER_SERVICE_TOKEN) headers.set("X-Parser-Token", env.PARSER_SERVICE_TOKEN);

  const response = await fetch(`${baseUrl}/parse`, {
    method: "POST",
    headers,
    body: formData,
  });
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : raw || response.statusText;
    throw new Error(`Ошибка parser-service: ${detail}`);
  }

  if (!data || typeof data !== "object") throw new Error("Parser service вернул пустой ответ.");
  return data as ParsedDocument;
}

function parsedDocumentText(parsed: ParsedDocument): string {
  const rootText = normalizeOptionalText(parsed.text);
  if (rootText) return rootText;

  const parts: string[] = [];
  for (const page of parsed.pages || []) {
    const text = normalizeOptionalText(page.text);
    if (text) {
      const pageNumber = Number(page.page_number || 0);
      parts.push(pageNumber ? `Страница ${pageNumber}:\n${text}` : text);
    }
  }

  return parts.join("\n\n").trim();
}

function parsedImagePages(parsed: ParsedDocument): ParsedImagePage[] {
  const pages: ParsedImagePage[] = [];
  for (const [index, page] of (parsed.pages || []).entries()) {
    const payload = filePayloadFromParsedPage(page);
    if (payload) pages.push({ pageNumber: Number(page.page_number || index + 1), payload });
  }
  return pages;
}

function filePayloadFromParsedPage(page: ParsedDocumentPage): FilePayload | null {
  const dataUrl = normalizeOptionalText(page.image_data_url);
  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) return { mimeType: match[1], base64: match[2], dataUrl };
  }

  const base64 = normalizeOptionalText(page.image_base64);
  if (!base64) return null;
  const mimeType = normalizeOptionalText(page.image_mime_type) || "image/jpeg";
  return {
    mimeType,
    base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function limitText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[Текст обрезан до ${maxLength} символов перед отправкой в ИИ.]`;
}

function stringValue(value: FormValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUploadedFile(value: FormValue | null): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      "arrayBuffer" in value &&
      typeof value.arrayBuffer === "function",
  );
}

function requireOpenAI(env: Env): void {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не задан. Установите secret через Wrangler.");
}

function requireGemini(env: Env): void {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY не задан. Установите secret через Wrangler.");
}

function useGemini(env: Env): boolean {
  return (env.AI_PROVIDER || "").toLowerCase() === "gemini";
}

async function fetchGeminiGenerateContent(
  env: Env,
  body: Record<string, unknown>,
  preferredModel = env.GEMINI_MODEL,
): Promise<Response> {
  return fetchGeminiWithRetry(env, "generateContent", body, preferredModel);
}

async function fetchGeminiInteractions(
  env: Env,
  body: Record<string, unknown>,
  preferredModel = env.GEMINI_MODEL,
): Promise<Response> {
  return fetchGeminiWithRetry(env, "interactions", body, preferredModel);
}

async function fetchGeminiWithRetry(
  env: Env,
  endpoint: "generateContent" | "interactions",
  body: Record<string, unknown>,
  preferredModel: string,
): Promise<Response> {
  const attempts = geminiRetryAttempts(env);
  const baseDelayMs = geminiRetryBaseDelayMs(env);
  let lastResponse: Response | null = null;
  let lastNetworkError = "";

  for (const model of geminiModelCandidates(env, preferredModel)) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const url = endpoint === "interactions" ? geminiInteractionsUrl() : geminiGenerateUrl(model);
        const requestBody = endpoint === "interactions" ? { ...body, model } : body;
        const response = await fetch(url, {
          method: "POST",
          headers: geminiHeaders(env),
          body: JSON.stringify(requestBody),
        });
        const raw = await response.text();
        lastResponse = cloneTextResponse(response, raw);

        if (response.ok) return lastResponse;
        if (!isGeminiRetryable(response.status, raw)) break;
        if (attempt < attempts) await sleep(geminiBackoffDelayMs(baseDelayMs, attempt));
      } catch (error) {
        lastNetworkError = error instanceof Error ? error.message : String(error);
        if (attempt < attempts) await sleep(geminiBackoffDelayMs(baseDelayMs, attempt));
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(`Не удалось соединиться с Gemini API после автоматических повторов: ${lastNetworkError || "нет ответа"}.`);
}

function cloneTextResponse(response: Response, raw: string): Response {
  return new Response(raw, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
    },
  });
}

function geminiModelCandidates(env: Env, preferredModel: string): string[] {
  const primary = (preferredModel || env.GEMINI_MODEL || "gemini-3.5-flash").trim();
  const fallbackModels = (env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return Array.from(new Set([primary, ...fallbackModels].filter(Boolean)));
}

function geminiRetryAttempts(env: Env): number {
  const value = Number(env.GEMINI_RETRY_ATTEMPTS || 3);
  if (!Number.isFinite(value)) return 3;
  return Math.min(Math.max(Math.trunc(value), 1), 5);
}

function geminiRetryBaseDelayMs(env: Env): number {
  const value = Number(env.GEMINI_RETRY_BASE_DELAY_MS || 800);
  if (!Number.isFinite(value)) return 800;
  return Math.min(Math.max(Math.trunc(value), 100), 5_000);
}

function geminiBackoffDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 8_000);
}

function isGeminiRetryable(status: number, raw: string): boolean {
  if (status === 429 || [500, 502, 503, 504].includes(status)) return true;
  const text = `${extractGeminiErrorMessage(raw)} ${raw}`.toLowerCase();
  return text.includes("high demand")
    || text.includes("spikes in demand")
    || text.includes("try again later")
    || text.includes("overloaded")
    || text.includes("temporarily unavailable")
    || text.includes("resource exhausted")
    || text.includes("rate limit");
}

function formatGeminiError(apiName: string, status: number, raw: string): string {
  const message = extractGeminiErrorMessage(raw);
  if (isGeminiRetryable(status, raw)) {
    return `${apiName} временно перегружен или ограничил запросы. Программа уже выполнила автоматические повторы, но ответ не получен. Повторите обработку через 1-2 минуты или укажите резервные модели в GEMINI_FALLBACK_MODELS. Детали: ${message}`;
  }
  return `Ошибка ${apiName}: ${message}`;
}

function extractGeminiErrorMessage(raw: string): string {
  try {
    const data = JSON.parse(raw);
    if (typeof data?.error?.message === "string") return data.error.message;
    if (typeof data?.message === "string") return data.message;
    if (typeof data?.error === "string") return data.error;
  } catch {
    // Use raw text below.
  }
  return raw || "пустой ответ";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openAIHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function geminiGenerateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function geminiInteractionsUrl(): string {
  return "https://generativelanguage.googleapis.com/v1beta/interactions";
}

function geminiHeaders(env: Env): HeadersInit {
  return {
    "x-goog-api-key": env.GEMINI_API_KEY,
    "Content-Type": "application/json",
  };
}

function isAdmin(user: CurrentUser): boolean {
  return user.role === "admin";
}

function canManageRequests(user: CurrentUser): boolean {
  return ["admin", "manager"].includes(user.role);
}

function canManageDocuments(user: CurrentUser): boolean {
  return ["admin", "manager", "accountant"].includes(user.role);
}

function canManageTasks(user: CurrentUser): boolean {
  return ["admin", "manager", "accountant"].includes(user.role);
}

function emailMailboxScope(user: CurrentUser): { sql: string; bindings: string[] } {
  if (isAdmin(user)) return { sql: "", bindings: [] };

  const emailAddress = normalizeCompanyMailboxAddress(user.email_address);
  if (!emailAddress) return { sql: "AND 1 = 0", bindings: [] };

  return {
    sql: "AND (lower(trim(mailbox_email)) = ? OR lower(trim(to_address)) = ?)",
    bindings: [emailAddress, emailAddress],
  };
}

function canAccessEmailMessage(user: CurrentUser, emailItem: Record<string, any>): boolean {
  if (isAdmin(user)) return true;

  const emailAddress = normalizeCompanyMailboxAddress(user.email_address);
  if (!emailAddress) return false;

  return normalizeCompanyMailboxAddress(emailItem.mailbox_email) === emailAddress
    || normalizeCompanyMailboxAddress(emailItem.to_address) === emailAddress;
}

function userToCurrentUser(row: Record<string, any>): CurrentUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    display_name: String(row.display_name),
    role: String(row.role),
    email_address: normalizeOptionalText(row.email_address),
  };
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function normalizeRole(value: unknown): string {
  const role = normalizeOptionalText(value) || "manager";
  return ["admin", "manager", "accountant", "viewer"].includes(role) ? role : "manager";
}

async function hashPassword(password: string, saltBase64 = ""): Promise<{ hash: string; salt: string }> {
  const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 100000,
    },
    key,
    256,
  );
  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
  };
}

async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  return timingSafeEqualBytes(base64ToBytes(actual.hash), base64ToBytes(expectedHash));
}

function timingSafeEqualBytes(actual: Uint8Array, expected: Uint8Array): boolean {
  let diff = actual.length ^ expected.length;
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (actual[index] || 0) ^ (expected[index] || 0);
  }
  return diff === 0;
}

function generateSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function sha256Base64UrlBytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function getCookie(request: Request, name: string): string {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;
    if (part.slice(0, separatorIndex) === name) return decodeURIComponent(part.slice(separatorIndex + 1));
  }
  return "";
}

function buildSessionCookie(request: Request, token: string, maxAge: number): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function toSqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function json(data: unknown, status = 200): Response {
  return jsonWithHeaders(data, status);
}

function jsonWithHeaders(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
