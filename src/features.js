export const BASE_FEATURES = {
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  rweb_video_timestamps_enabled: true,
  responsive_web_media_download_video_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  responsive_web_enhance_cards_enabled: false,
};

export function bookmarkFeatures() {
  return { ...BASE_FEATURES, graphql_timeline_v2_bookmark_timeline: true };
}

export function bookmarkFolderFeatures() {
  return {
    ...BASE_FEATURES,
    rweb_tipjar_consumption_enabled: true,
    communities_web_enable_tweet_community_results_fetch: true,
    articles_preview_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    tweet_with_visibility_results_prefer_gql_media_interstitial_enabled: true,
  };
}

export function tweetFeatures() {
  return { ...BASE_FEATURES, graphql_timeline_v2_bookmark_timeline: false };
}

export function compactFeatures(features) {
  const out = {};
  for (const [key, value] of Object.entries(features)) {
    if (value !== false) out[key] = value;
  }
  return out;
}
