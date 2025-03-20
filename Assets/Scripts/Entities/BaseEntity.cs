using Entities.Components;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Grid;
using UnityEngine;

namespace Entities
{
    public abstract class BaseEntity : MonoBehaviour
    {
        [SerializeField] private Vector3Int spawnPosition;
        [SerializeField] private EntitySelectionType selectionType;

        [Header("Characteristics")]
        [SerializeField] private int health;

        public readonly Vector3 OffsetToTileCenter = new Vector3(0.5f, 0.5f, 0);

        public Vector3Int GridPosition { get; private set; }
        
        public Health Health { get; private set; }

        public EntitySelectionType SelectionType => selectionType;

        public Vector3Int SpawnPosition => spawnPosition;

        public int MaxHealth => health;

        public virtual void Init()
        {
            Health = new Health(health, transform);
            
            // Health.OnDie.AddListener(Dispose);
        }

        public UniTask Move(Vector3Int gridPosition, float duration = 0.3f)
        {
            // if (Health.IsDead) return default;

            GridPosition = gridPosition;
            
            return transform.DOMove(GridService.GridPositionToTileCenter(gridPosition), duration).ToUniTask();
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