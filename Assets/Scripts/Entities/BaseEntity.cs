using System;
using Entities.Components;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Grid;
using UnityEngine;

namespace Entities
{
    public abstract class BaseEntity : MonoBehaviour
    {
        [SerializeField] private Vector3 spawnPosition;
        [SerializeField] private EntitySelectionType selectionType;

        [Header("Characteristics")]
        [SerializeField] private int health;

        private readonly Vector3 _offsetToTileCenter = new Vector3(0.5f, 0.5f, 0);

        public Vector3 GridPosition { get; private set; }
        
        public Health Health { get; private set; }

        public EntitySelectionType SelectionType => selectionType;

        public Vector3 SpawnPosition => spawnPosition;

        public int MaxHealth => health;

        public virtual void Init()
        {
            Health = new Health(health, transform);
            
            // Health.OnDie.AddListener(Dispose);
        }
        
        public void SetCell(Vector3 position)
        {
            transform.position = position + _offsetToTileCenter;
            
            GridPosition = position;
        }

        public Vector3 GetTilePosition()
        {
            return transform.position - _offsetToTileCenter;
        }

        public UniTask Move(Vector3 position, float duration = 0.3f)
        {
            // if (Health.IsDead) return default;

            GridPosition = position;
            
            return transform.DOMove(position + _offsetToTileCenter, duration).ToUniTask();
        }

        public virtual void Dispose()
        {
            // cell = null;

            // Destroy(gameObject);
            Health.OnDie.RemoveAllListeners();
        }
    }

    public enum EntityType
    {
        Enemy,
        Hero,
    }
    
    public enum EntitySelectionType
    {
        Red,
        Green,
        Blue,
        Neutral,
    }
}