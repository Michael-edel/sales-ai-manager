from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException, status
from openai import OpenAI, OpenAIError

from app.config import get_settings


REQUIRED_OUTPUT = """
Вывод должен строго содержать разделы:
A. Краткое резюме
B. Извлеченные данные
C. Решение для 1С
D. Черновик для клиента
E. Вопросы для уточнения
F. Финальный юридический статус сделки
"""

COMPANY_DEFAULTS = """
Обязательные настройки MVP ТОО Michael:
- Все коммерческие предложения, счета и клиентские цены формируются от ТОО Michael.
- Для клиента всегда готовить цены в формате «с НДС». НДС для Казахстана — 16%, если в регламенте или документах сделки не указано иное.
- Не задавать клиенту вопрос «нужна цена с НДС или без НДС» и не спрашивать, от какого юрлица выставлять счет.
- Если видна цена со стороннего сайта/прайса, не использовать ее как финальную цену ТОО Michael без подтверждения. Писать: «цена с НДС от ТОО Michael уточняется».
- Если подтвержденной цены ТОО Michael нет, не рассчитывать сумму по сторонней цене. В полях цены и суммы писать «уточняется».
- Клиент ТОО KBI Energy / KBI Energy / КБИ Энерджи — VIP/оптовый покупатель с высоким приоритетом.
- По ТОО KBI Energy работа идет по годовому договору. Каждый счет должен сопровождаться приложением к договору.
- Для KBI Energy не спрашивать, нужен ли счет от ТОО Michael: счет от ТОО Michael и приложение к договору оформляются по умолчанию.
- Для KBI Energy в разделе D готовить короткий WhatsApp-текст о направлении счета и приложения к договору.
- Для KBI Energy в разделе F указывать юридическое требование: «счет отправлять вместе с приложением к договору». Если приложения нет или не указан номер/дата приложения, писать: «требуется подготовить приложение к договору».
- Для KBI Energy в разделе E задавать только недостающие критические вопросы: номер/дата договора, номер приложения, адрес/условия доставки, если они отсутствуют.
- В каждой заявке фиксировать: компанию клиента, контакт/менеджера клиента, ответственного менеджера Michael и канал связи.
- У ТОО KBI Energy может быть несколько менеджеров. Не смешивать запросы разных менеджеров клиента, если указаны разные имена/контакты.
- У ТОО Michael может быть несколько менеджеров. В разделе A и C указывать ответственного менеджера Michael, если он задан в контексте.
- Канал связи важен: WhatsApp, Telegram и Email считаются основными рабочими каналами. В разделе D готовить текст под указанный канал.
- Голосовые сообщения WhatsApp/Telegram после транскрибации считать полноценным входящим запросом. Если транскрибация неуверенная, вынести сомнительные места в раздел E.
"""


def load_system_prompt(prompt_path: Path) -> str:
    if not prompt_path.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Файл системного промпта не найден: {prompt_path}",
        )
    prompt = prompt_path.read_text(encoding="utf-8").strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Файл системного промпта пустой. Заполните backend/prompts/sales_manager_system.md.",
        )
    return f"{prompt}\n\n{COMPANY_DEFAULTS}\n\n{REQUIRED_OUTPUT}"


def analyze_request(original_text: str) -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY не задан. Укажите ключ в .env.",
        )

    client = OpenAI(api_key=settings.openai_api_key)

    try:
        response = client.responses.create(
            model=settings.openai_model,
            instructions=load_system_prompt(settings.prompt_path),
            input=(
                "Проанализируй входящую заявку менеджера по продажам. "
                "Не выдумывай отсутствующие данные; если данных нет, пиши «уточняется».\n\n"
                f"Заявка:\n{original_text}"
            ),
        )
    except OpenAIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ошибка OpenAI API: {exc}",
        ) from exc

    result = getattr(response, "output_text", None)
    if not result:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="OpenAI API вернул пустой ответ.")
    return result


def transcribe_audio(audio_file: BinaryIO, filename: str, manager_note: str = "") -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY не задан. Укажите ключ в .env.",
        )

    prompt = (
        "Это голосовое сообщение из WhatsApp/Telegram по B2B-продажам электротехники в Казахстане. "
        "Особенно внимательно распознавай названия компаний, товары, артикулы, количество, города, условия доставки. "
        "Возможные компании: ТОО Michael, ТОО KBI Energy."
    )
    if manager_note.strip():
        prompt = f"{prompt}\nКонтекст менеджера: {manager_note.strip()}"

    client = OpenAI(api_key=settings.openai_api_key)
    try:
        transcription = client.audio.transcriptions.create(
            model=settings.openai_transcribe_model,
            file=(filename, audio_file),
            response_format="text",
            prompt=prompt,
        )
    except OpenAIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ошибка транскрибации OpenAI API: {exc}",
        ) from exc

    if isinstance(transcription, str):
        text_result = transcription
    else:
        text_result = getattr(transcription, "text", "")

    text_result = text_result.strip()
    if not text_result:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="OpenAI API вернул пустую транскрибацию.")
    return text_result


def analyze_image_request(image_data_url: str, filename: str, manager_note: str = "") -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY не задан. Укажите ключ в .env.",
        )

    client = OpenAI(api_key=settings.openai_api_key)
    note_text = f"\n\nПояснение менеджера к файлу:\n{manager_note.strip()}" if manager_note.strip() else ""
    user_text = (
        "Проанализируй изображение как входящую заявку менеджера по продажам. "
        "Это может быть скриншот WhatsApp/Telegram, фото товара, фото счета или смешанный запрос. "
        "Извлеки видимые товары, количество, реквизиты и требования. "
        "Если часть изображения нечитаема или данных недостаточно, явно укажи это и пиши «уточняется». "
        f"Имя файла: {filename}"
        f"{note_text}"
    )

    try:
        response = client.responses.create(
            model=settings.openai_model,
            instructions=load_system_prompt(settings.prompt_path),
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": user_text},
                        {"type": "input_image", "image_url": image_data_url},
                    ],
                }
            ],
        )
    except OpenAIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ошибка OpenAI API: {exc}",
        ) from exc

    result = getattr(response, "output_text", None)
    if not result:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="OpenAI API вернул пустой ответ.")
    return result
