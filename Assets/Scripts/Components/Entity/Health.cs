using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;
using UnityEngine.Events;

namespace Components.Entity
{
    public class Health
    {
        private int _value;

        public bool IsDead { get; private set; }

        public UnityEvent OnDie = new();

        public UnityEvent OnDamageTaken = new();

        public UnityEvent<int> OnValueChanged = new();
        
        public int Value
        {
            get => _value;
            private set
            {
                _value = value;
                OnValueChanged.Invoke(_value);
            }
        }

        private Transform _transform;

        public Health(int health, Transform transform)
        {
            Value = health;
            _transform = transform;
        }

        public void SetValue(int target)
        {
            Value = target;
        }

        public async UniTask TakeDamage(int damage)
        {
            Value -= damage;
            
            OnDamageTaken.Invoke();
            
            if (Value < 0)
            {
                await DieAnimation();
             
                IsDead = true;
                OnDie.Invoke();
            }
            else
            {
                await DamageAnimation();
            }
        }

        private UniTask DamageAnimation()
        {
            return _transform.DOShakePosition(0.2f, 0.4f).ToUniTask();
        }
        
        private UniTask DieAnimation()
        {
            return _transform.DOScale(0, 0.1f).ToUniTask();
        }
    }
    
    public enum DieReason
    {
        Undefined,
        Hero,
    }
}