import unittest
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from xarchiver.db import connect
from xarchiver.services.library import get_tweet_detail, list_posts_page
from xarchiver.services.media_deletion import delete_media_assets
from xarchiver.services.organization import (
    bulk_update_labels,
    create_collection,
    create_tag,
    delete_collection,
    delete_tag,
    get_tweet_organization,
    list_organization_catalog,
    replace_tweet_labels,
    save_tweet_note,
    update_collection,
)
from xarchiver.services.sources import delete_source


class OrganizationIntegrationTests(unittest.TestCase):
    tweet_ids = ["organization-fixture-1", "organization-fixture-2"]
    source_url = "https://x.com/organization_fixture/media"

    def setUp(self) -> None:
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                for index, tweet_id in enumerate(self.tweet_ids, start=1):
                    cur.execute(
                        """
                        insert into tweets (
                            tweet_id, url, author_username, text, published_at, download_status
                        )
                        values (%s, %s, 'organization_fixture', %s, %s, 'verified')
                        """,
                        (
                            tweet_id,
                            f"https://x.com/organization_fixture/status/{tweet_id}",
                            f"organization fixture {index}",
                            f"2026-01-0{index} 00:00:00+00",
                        ),
                    )
                    cur.execute(
                        """
                        insert into media_assets (
                            tweet_id, media_index, media_type, local_path,
                            source_engine, download_status
                        )
                        values (%s, 1, 'photo', %s, 'test', 'verified')
                        returning id
                        """,
                        (tweet_id, f"/app/archive/media/organization/{tweet_id}.jpg"),
                    )
                    if index == 1:
                        self.cover_media_id = int(cur.fetchone()["id"])
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
                cur.execute("delete from archive_sources where source_url = %s", (self.source_url,))
                cur.execute("delete from tags where normalized_name like 'organization-test-%'")
                cur.execute("delete from collections where normalized_name like 'organization-test-%'")
                cur.execute(
                    "delete from media_delete_operations where tweet_ids ?| array[%s, %s]",
                    tuple(self.tweet_ids),
                )
                cur.execute(
                    """
                    delete from organization_action_events
                    where target_id like 'organization-fixture-%'
                       or details ->> 'name' like 'Organization-Test-%'
                    """
                )
            conn.commit()

    def test_tag_collection_note_crud_and_card_summaries(self) -> None:
        tag = create_tag("Organization-Test-Physics", "#3366ff", "Physics")
        collection = create_collection("Organization-Test-Research", "Research")
        replace_tweet_labels(self.tweet_ids[0], [int(tag["id"])], [int(collection["id"])])
        saved = save_tweet_note(self.tweet_ids[0], "private organization note")

        organization = get_tweet_organization(self.tweet_ids[0])
        catalog = list_organization_catalog(Path("/app/archive"))
        detail = get_tweet_detail(
            SimpleNamespace(archive_dir=Path("/app/archive")),
            self.tweet_ids[0],
        )
        feed = list_posts_page(
            SimpleNamespace(archive_dir=Path("/app/archive")),
            author_username="organization_fixture",
            limit=10,
        )

        self.assertEqual(saved["note"]["content"], "private organization note")
        assert organization is not None
        self.assertEqual([row["name"] for row in organization["tags"]], ["Organization-Test-Physics"])
        self.assertEqual(
            [row["name"] for row in organization["collections"]],
            ["Organization-Test-Research"],
        )
        self.assertEqual(detail["organization"]["note"]["content"], "private organization note")
        first = next(row for row in feed["rows"] if row["tweet_id"] == self.tweet_ids[0])
        self.assertEqual(first["tags"], ["Organization-Test-Physics"])
        self.assertEqual(first["collection_count"], 1)
        self.assertTrue(first["has_note"])
        self.assertIn(int(tag["id"]), {row["id"] for row in catalog["tags"]})

    def test_names_are_case_insensitive_unique_and_inputs_are_validated(self) -> None:
        create_tag("Organization-Test-Unique", "#123456")
        create_collection("Organization-Test-Unique Collection")

        with self.assertRaisesRegex(ValueError, "tag_name_exists"):
            create_tag(" organization-test-unique ")
        with self.assertRaisesRegex(ValueError, "tag_color_invalid"):
            create_tag("Organization-Test-Bad-Color", "red")
        with self.assertRaisesRegex(ValueError, "collection_name_exists"):
            create_collection("organization-test-unique collection")

    def test_collection_cover_must_be_an_existing_member(self) -> None:
        collection = create_collection("Organization-Test-Cover")
        with self.assertRaisesRegex(ValueError, "collection_cover_not_member"):
            update_collection(
                int(collection["id"]),
                "Organization-Test-Cover",
                None,
                self.cover_media_id,
            )

        replace_tweet_labels(self.tweet_ids[0], [], [int(collection["id"])])
        updated = update_collection(
            int(collection["id"]),
            "Organization-Test-Cover",
            None,
            self.cover_media_id,
        )

        self.assertEqual(updated["cover_media_id"], self.cover_media_id)

    def test_bulk_changes_are_exact_audited_and_limited(self) -> None:
        add_tag = create_tag("Organization-Test-Add")
        remove_tag = create_tag("Organization-Test-Remove")
        collection = create_collection("Organization-Test-Bulk")
        replace_tweet_labels(self.tweet_ids[0], [int(remove_tag["id"])], [])

        result = bulk_update_labels(
            self.tweet_ids,
            add_tag_ids=[int(add_tag["id"])],
            remove_tag_ids=[int(remove_tag["id"])],
            add_collection_ids=[int(collection["id"])],
            remove_collection_ids=[],
        )

        self.assertEqual(result["selected_tweet_count"], 2)
        for tweet_id in self.tweet_ids:
            organization = get_tweet_organization(tweet_id)
            assert organization is not None
            self.assertIn("Organization-Test-Add", {row["name"] for row in organization["tags"]})
            self.assertIn(
                "Organization-Test-Bulk",
                {row["name"] for row in organization["collections"]},
            )
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select tweet_ids, details
                    from organization_action_events
                    where action = 'bulk_labels_updated'
                    order by id desc
                    limit 1
                    """
                )
                audit = cur.fetchone()
        self.assertEqual(audit["tweet_ids"], self.tweet_ids)
        self.assertEqual(audit["details"]["added_tag_links"], 2)
        with self.assertRaisesRegex(ValueError, "invalid_organization_tweet_selection"):
            bulk_update_labels(
                [f"too-many-{index}" for index in range(201)],
                add_tag_ids=[int(add_tag["id"])],
                remove_tag_ids=[],
                add_collection_ids=[],
                remove_collection_ids=[],
            )

    def test_delete_requires_confirmation_and_keeps_tweets_and_media(self) -> None:
        tag = create_tag("Organization-Test-Delete")
        collection = create_collection("Organization-Test-Delete Collection")
        replace_tweet_labels(self.tweet_ids[0], [int(tag["id"])], [int(collection["id"])])

        with self.assertRaisesRegex(ValueError, "organization_delete_confirmation_required"):
            delete_tag(int(tag["id"]), confirmed=False)
        with self.assertRaisesRegex(ValueError, "organization_delete_confirmation_required"):
            delete_collection(int(collection["id"]), confirmed=False)

        tag_result = delete_tag(int(tag["id"]), confirmed=True)
        collection_result = delete_collection(int(collection["id"]), confirmed=True)

        self.assertEqual(tag_result["affected_tweet_count"], 1)
        self.assertEqual(collection_result["affected_tweet_count"], 1)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*) as count from tweets where tweet_id = %s", (self.tweet_ids[0],))
                self.assertEqual(cur.fetchone()["count"], 1)
                cur.execute("select count(*) as count from media_assets where tweet_id = %s", (self.tweet_ids[0],))
                self.assertEqual(cur.fetchone()["count"], 1)

    def test_media_delete_and_source_soft_delete_preserve_organization(self) -> None:
        tag = create_tag("Organization-Test-Preserved")
        collection = create_collection("Organization-Test-Preserved Collection")
        replace_tweet_labels(self.tweet_ids[0], [int(tag["id"])], [int(collection["id"])])
        save_tweet_note(self.tweet_ids[0], "preserve this note")
        update_collection(
            int(collection["id"]),
            "Organization-Test-Preserved Collection",
            None,
            self.cover_media_id,
        )
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into archive_sources (source_type, source_url, author_username)
                    values ('user_media', %s, 'organization_fixture')
                    returning id
                    """,
                    (self.source_url,),
                )
                source_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into source_discovered_tweets (source_id, tweet_id, raw_payload)
                    values (%s, %s, '{}'::jsonb)
                    """,
                    (source_id, self.tweet_ids[0]),
                )
            conn.commit()

        delete_media_assets(
            SimpleNamespace(archive_dir=Path("/app/archive")),
            uuid4(),
            [self.cover_media_id],
        )
        delete_source(source_id, confirm_delete=True)

        organization = get_tweet_organization(self.tweet_ids[0])
        catalog = list_organization_catalog(Path("/app/archive"))
        assert organization is not None
        self.assertEqual([row["name"] for row in organization["tags"]], ["Organization-Test-Preserved"])
        self.assertEqual(
            [row["name"] for row in organization["collections"]],
            ["Organization-Test-Preserved Collection"],
        )
        self.assertEqual(organization["note"]["content"], "preserve this note")
        preserved_collection = next(
            row for row in catalog["collections"] if row["id"] == collection["id"]
        )
        self.assertIsNone(preserved_collection["cover_media_id"])
        self.assertEqual(preserved_collection["tweet_count"], 1)


if __name__ == "__main__":
    unittest.main()
