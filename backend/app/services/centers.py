"""Center coordinates are operator-maintained; recycler locations are never stored."""

from ..schemas import CenterConfiguration


def configure_center(c, data: CenterConfiguration):
    c.execute(
        "INSERT INTO centers (id,name,address) VALUES (?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address",
        (data.id, data.name, data.address),
    )
    c.execute(
        "INSERT INTO center_locations (center_id,latitude,longitude,is_demo) VALUES (?,?,?,0) "
        "ON CONFLICT(center_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,is_demo=0",
        (data.id, data.latitude, data.longitude),
    )
