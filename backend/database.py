from sqlalchemy import BigInteger, String, UniqueConstraint, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class VideoRow(Base):
    __tablename__ = "videos"

    video_id: Mapped[str] = mapped_column(String(11), primary_key=True)
    title: Mapped[str] = mapped_column(String(512), default="")
    video_url: Mapped[str] = mapped_column(String(255), default="")
    thumbnail_url: Mapped[str] = mapped_column(String(512), default="")
    publish_time: Mapped[str] = mapped_column(String(10), default="")
    channel_title: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[str] = mapped_column(String(19), default="")


class HistoryRow(Base):
    __tablename__ = "history"
    __table_args__ = (UniqueConstraint("video_id", "snapshot_bucket", name="uq_video_bucket"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(String(11), index=True)
    snapshot_time: Mapped[str] = mapped_column(String(19))
    snapshot_bucket: Mapped[str] = mapped_column(String(19))
    view_count: Mapped[int] = mapped_column(BigInteger, default=0)
    like_count: Mapped[int] = mapped_column(BigInteger, default=0)
    comment_count: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[str] = mapped_column(String(19), default="")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def check_db() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
