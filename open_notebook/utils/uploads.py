"""Helpers for files stored in the uploads folder.

Shared by the upload endpoint and by the cloud-storage sync, which downloads
remote files into the same folder so they go through the same containment
checks as manual uploads.
"""

import os
from pathlib import Path


def generate_unique_filename(original_filename: str, upload_folder: str) -> str:
    """Generate unique filename like Streamlit app (append counter if file exists),
    atomically reserving it so two concurrent uploads that land on the same
    candidate name can't both pass the check and then clobber each other -
    the loser's claim attempt fails and moves on to the next candidate."""
    file_path = Path(upload_folder)
    file_path.mkdir(parents=True, exist_ok=True)

    # Strip directory components to prevent path traversal
    safe_filename = os.path.basename(original_filename)
    if not safe_filename:
        raise ValueError("Invalid filename")

    # Split filename and extension
    stem = Path(safe_filename).stem
    suffix = Path(safe_filename).suffix
    safe_root = file_path.resolve()

    # Find and atomically claim a unique name
    counter = 0
    while True:
        if counter == 0:
            new_filename = safe_filename
        else:
            new_filename = f"{stem} ({counter}){suffix}"

        full_path = file_path / new_filename
        # Verify resolved path stays within upload folder
        resolved = full_path.resolve()
        if not str(resolved).startswith(str(safe_root) + os.sep):
            raise ValueError("Invalid filename: path traversal detected")

        try:
            # O_EXCL via touch(exist_ok=False): atomically create-or-fail,
            # instead of exists() (check) followed by a separate write
            # (act) elsewhere with a race window in between.
            resolved.touch(exist_ok=False)
            return str(resolved)
        except FileExistsError:
            counter += 1
