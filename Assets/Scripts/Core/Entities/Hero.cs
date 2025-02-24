using System;
using Abilities.HeroAbilities;
using UnityEngine;


// TODO: Нужно подумать над калькуляцией урона

namespace Core.Entities
{
    public class Hero : Entity
    {
        // [Header("Hero Settings")]
        private int _remainingDamage;

        public event Action<int> OnAttackDamageChanged;
        
        public int RemainingDamage
        {
            get => _remainingDamage;
            private set
            {
                _remainingDamage = value;
                OnAttackDamageChanged?.Invoke(value);
            }
        }

        private void Awake()
        {
            Type = EntityType.Hero;
            SetDamage(AttackDamage);
        }
        
        public void SetDamage(int initialDamage)
        {
            RemainingDamage = initialDamage;
        }

        public void ResetDamage()
        {
            RemainingDamage = AttackDamage;
        }

        public override void Die()
        {
            // Логика смерти героя (Game Over, вычитание жизней и т. п.).
            Debug.Log("Hero has died! Game Over?");

            // Не забываем вызвать базовый Die(), чтобы сущность удалялась из сцены
            // или, если нужно, можно убрать Destroy(gameObject) и реализовать здесь свою механику.
            base.Die();
        }

        public BaseAbility[] GetAbilities()
        {
            return GetComponents<BaseAbility>();
        }
    }
}