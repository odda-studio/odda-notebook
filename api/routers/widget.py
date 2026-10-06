"""Public endpoints used by the website widget (authenticated by widget key,
NOT by the API password: these paths are excluded from the password check)."""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from api import widget_service
from api.models import WidgetChatRequest

router = APIRouter()

WIDGET_BUNDLE = Path(__file__).resolve().parents[2] / "widget" / "dist" / "odda-notebook-widget.js"


@router.get("/widget/embed.js", include_in_schema=False)
async def widget_bundle():
    if not WIDGET_BUNDLE.is_file():
        return JSONResponse(
            {"detail": "The widget is not built. Run `make widget-build`."}, status_code=404
        )
    return FileResponse(
        WIDGET_BUNDLE,
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.post("/widget/chat")
async def widget_chat(
    body: WidgetChatRequest,
    request: Request,
    x_widget_key: Optional[str] = Header(None),
):
    origin = request.headers.get("origin")
    ip = widget_service.client_ip(
        dict(request.headers), request.client.host if request.client else None
    )
    widget_key = await widget_service.authenticate(
        x_widget_key, body.notebook_id, origin, ip
    )
    prepared = await widget_service.prepare_answer(widget_key, body, origin)
    return StreamingResponse(
        widget_service.stream_answer(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
