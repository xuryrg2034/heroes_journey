using System;
using DG.Tweening;
using DG.Tweening.Core;
using DG.Tweening.Plugins.Options;
using Grid;
using UnityEngine;

namespace Core.Entities
{
    public class Entity : MonoBehaviour
    {
        [Header("Entity Base Fields")]
        [SerializeField] private int health = 10; // Текущее здоровье
        [SerializeField] private int attackDamage = 2; // Урон
        [SerializeField] private int attackRange = 1; // Дальность атаки (0 = ближняя)
        [SerializeField] private EntityType type; // Тип сущности (например, враг / герой / или другое)
        [SerializeField] public Cell cell;
        
        protected SpriteRenderer SRenderer;
        private bool _isSelected;
        private protected Color _initColor;

        public Cell Cell => cell;

        // События
        public static event Action<int> OnTakeDamage; // Срабатывает при получении урона, передаём величину урона
        public static event Action<int> OnHeal; // Срабатывает при лечении, передаём величину лечения
        public event Action OnHealthChange;
        public static event Action<Entity> OnDie;

        public bool IsSelected
        {
            get => _isSelected;
            set
            {
                if (SRenderer != null)
                {
                    SRenderer.color = value ? Color.yellow : _initColor;   
                }
                _isSelected = value;
            }
        }

        public int Health
        {
            get => health;
            private set
            {
                health = value;
                OnHealthChange?.Invoke();
            }
        }

        public int AttackDamage
        {
            get => attackDamage;
            set => attackDamage = value;
        }

        public int AttackRange
        {
            get => attackRange;
            set => attackRange = value;
        }

        public EntityType Type
        {
            get => type;
            set => type = value;
        }
        
        protected virtual void Start()
        {
            SRenderer = GetComponent<SpriteRenderer>();
            _initColor = SRenderer.color;
        }
        
        public virtual Tween TakeDamage(int damage)
        {
            if (damage <= 0) return default;

            var tween = SRenderer.DOColor(Color.blue, 0.3f);
            
            tween.OnComplete(() =>
            {
                Health -= damage;
                OnTakeDamage?.Invoke(damage);
                
                if (Health <= 0)
                {
                    Die();
                }
                else
                {
                    SRenderer.color = _initColor;   
                }
            });

            return tween;
        }

        public void SetHealth(int value)
        {
            health = value;
        }
        
        public TweenerCore<Vector3, Vector3, VectorOptions> Move(Cell targetCell, float duration = 0.3f)
        {
            SetCell(targetCell);

            return transform.DOMove(targetCell.transform.position, duration);
        }
        
        public virtual void Heal(int amount)
        {
            if (amount <= 0) return;

            Health += amount;
            OnHeal?.Invoke(amount);

            // Если нужен maxHealth, здесь можно ограничить Health
        }

        public virtual void Die()
        {
            // Дополнительная логика (анимация, удаление с поля и т.д.)
            OnDie?.Invoke(this);
            Destroy(gameObject);
        }

        public void SetCell(Cell targetCell, bool doMove = false)
        {
            cell = targetCell;

            if (doMove)
            {
                transform.position = cell.transform.position;
            }
        }
    }

    public enum EntityType
    {
        Hero,
        Enemy,
        Neutral
    }
}