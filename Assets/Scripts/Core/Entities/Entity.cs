using System;
using Components.Entity;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Grid;
using UnityEngine;
using UnityEngine.Events;

namespace Core.Entities
{
    public abstract class Entity : MonoBehaviour
    {
        [SerializeField] private Cell cell;
        [SerializeField] private EntityType type;

        [Header("Characteristics")]
        [SerializeField] private int health;

        public static readonly UnityEvent<Entity> OnBeforeDestroy = new();
        
        public Health Health { get; private set; }

        public EntityType Type => type;

        public Cell Cell => cell;

        protected virtual void Start()
        {
            Health = new Health(health, transform);

            _subscriptionsOnEvent();
        }
        
        public abstract void Init();
        
        public void SetCell(Cell value)
        {
            cell = value;
            transform.position = value.transform.position;
        }

        public UniTask Move(Cell targetCell, float duration = 0.3f)
        {
            cell = targetCell;
            
            return transform.DOMove(targetCell.transform.position, duration).ToUniTask();
        }
        
        private void _beforeDestroy()
        {
            OnBeforeDestroy.Invoke(this);
            Destroy(this);
        }
        
        private void _subscriptionsOnEvent()
        {
            Health.OnDie.AddListener(_beforeDestroy);
        }
    }

    public enum EntityType
    {
        Enemy,
        Hero,
    }
}