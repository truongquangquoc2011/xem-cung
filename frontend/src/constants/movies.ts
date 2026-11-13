export interface MovieCategoryOption {
  slug: string;
  label: string;
  featured?: boolean;
  aiFeatured?: boolean;
  badge?: string;
}

export const MOVIE_CATEGORIES: MovieCategoryOption[] = [
  { slug: 'viet-nam', label: 'Việt Nam', featured: true },
  { slug: 'phim-ai', label: 'Phim AI', aiFeatured: true, badge: 'Mới' },
  { slug: '', label: 'Tất cả' },
  { slug: 'phim-le', label: 'Phim lẻ' },
  { slug: 'phim-bo', label: 'Phim bộ' },
  { slug: 'hoat-hinh', label: 'Hoạt hình' },
  { slug: 'han-quoc', label: 'Hàn Quốc' },
  { slug: 'trung-quoc', label: 'Trung Quốc' },
  { slug: 'nhat-ban', label: 'Nhật Bản' },
  { slug: 'au-my', label: 'Âu Mỹ' },
  { slug: 'hanh-dong', label: 'Hành động' },
  { slug: 'tinh-cam', label: 'Tình cảm' },
  { slug: 'hai-huoc', label: 'Hài hước' },
  { slug: 'kinh-di', label: 'Kinh dị' },
  { slug: 'vien-tuong', label: 'Viễn tưởng' },
];

export type HotPeriod = 'today' | 'week' | 'month';

export const HOT_PERIODS: { key: HotPeriod; label: string }[] = [
  { key: 'today', label: 'Hot hôm nay' },
  { key: 'week', label: 'Hot tuần này' },
  { key: 'month', label: 'Hot tháng này' },
];
